import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt, encrypt, isLegacyFormat } from './encryption';

/**
 * Where a WhatsApp connection's credentials come from.
 *
 * A number connected through Tenants lives on `crm_tenants`; older installs
 * keep one connection per user in `whatsapp_config`. Sending code needs one
 * answer regardless of where the connection was saved, so this prefers the
 * tenant connection and falls back to the legacy row.
 */

export interface WhatsAppCredentials {
  phoneNumberId: string;
  accessToken: string;
  wabaId: string | null;
  source: 'tenant' | 'legacy';
  /** Present only for a legacy token still stored with the old cipher. */
  upgradeLegacyToken?: () => Promise<void>;
}

async function loadTenantCredentials(
  supabase: SupabaseClient,
  userId: string,
  tenantId: string | null
): Promise<WhatsAppCredentials | null> {
  const base = supabase
    .from('crm_tenants')
    .select('phone_number_id, waba_id, access_token_enc')
    .eq('status', 'active')
    .not('access_token_enc', 'is', null)
    .not('phone_number_id', 'is', null);

  // A conversation knows which tenant it belongs to; otherwise use the oldest
  // active connection the user owns.
  const { data, error } = tenantId
    ? await base.eq('id', tenantId).maybeSingle()
    : await base
        .eq('owner_user_id', userId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

  if (error) {
    console.error('[credentials] tenant lookup failed:', error.message);
    return null;
  }
  if (!data?.access_token_enc || !data.phone_number_id) return null;

  try {
    return {
      phoneNumberId: data.phone_number_id,
      accessToken: decrypt(data.access_token_enc),
      wabaId: data.waba_id ?? null,
      source: 'tenant',
    };
  } catch {
    console.error('[credentials] could not decrypt the tenant token');
    return null;
  }
}

async function loadLegacyCredentials(
  supabase: SupabaseClient,
  userId: string
): Promise<WhatsAppCredentials | null> {
  const { data: config, error } = await supabase
    .from('whatsapp_config')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('[credentials] legacy lookup failed:', error.message);
    return null;
  }
  if (!config) return null;

  const accessToken = decrypt(config.access_token);
  return {
    phoneNumberId: config.phone_number_id,
    accessToken,
    wabaId: config.waba_id ?? null,
    source: 'legacy',
    upgradeLegacyToken: isLegacyFormat(config.access_token)
      ? async () => {
          const { error: upgradeError } = await supabase
            .from('whatsapp_config')
            .update({ access_token: encrypt(accessToken) })
            .eq('id', config.id);
          if (upgradeError) {
            console.warn(
              '[credentials] access_token GCM upgrade failed:',
              upgradeError.message
            );
          }
        }
      : undefined,
  };
}

/**
 * Credentials for the number a conversation belongs to. Automated senders
 * (flows, automations) know the conversation but not its tenant, and one user
 * can own several tenants, so the tenant is read from the conversation rather
 * than guessed from the user.
 */
export async function loadCredentialsForConversation(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string
): Promise<WhatsAppCredentials | null> {
  const withNumber = await supabase
    .from('conversations')
    .select('tenant_id, phone_number_id')
    .eq('id', conversationId)
    .eq('user_id', userId)
    .maybeSingle();

  // If the numbers migration (028) has not been applied the column is missing
  // and that query errors; read just the tenant so sending keeps working.
  const data = withNumber.error
    ? (
        await supabase
          .from('conversations')
          .select('tenant_id')
          .eq('id', conversationId)
          .eq('user_id', userId)
          .maybeSingle()
      ).data
    : withNumber.data;
  const conversation = data as {
    tenant_id: string | null;
    phone_number_id?: string | null;
  } | null;
  const tenantId = conversation?.tenant_id ?? null;

  // A tenant can own several numbers. Reply from the one the conversation is
  // on; conversations without one (older data) use the tenant's primary.
  if (conversation?.phone_number_id && tenantId) {
    const fromNumber = await loadNumberCredentials(
      supabase,
      tenantId,
      conversation.phone_number_id
    );
    if (fromNumber) return fromNumber;
  }
  return loadWhatsAppCredentials(supabase, userId, tenantId);
}

/**
 * Credentials for one specific number of a tenant. Returns null when the
 * number is unknown, disabled, belongs to another tenant, or the tenant is not
 * active, so callers can fall back to the primary number.
 */
export async function loadNumberCredentials(
  supabase: SupabaseClient,
  tenantId: string,
  phoneNumberId: string
): Promise<WhatsAppCredentials | null> {
  const { data, error } = await supabase
    .from('crm_tenant_numbers')
    .select(
      'phone_number_id, waba_id, access_token_enc, crm_tenants!inner(status, access_token_enc)'
    )
    .eq('tenant_id', tenantId)
    .eq('phone_number_id', phoneNumberId)
    .eq('status', 'active')
    .eq('crm_tenants.status', 'active')
    .maybeSingle();

  if (error) {
    console.error('[credentials] number lookup failed:', error.message);
    return null;
  }
  if (!data) return null;

  // A number without its own token shares the tenant's (numbers under one
  // business account normally use the same system-user token).
  const embed = data.crm_tenants as
    | { access_token_enc: string | null }
    | Array<{ access_token_enc: string | null }>
    | null;
  const tenantToken = (Array.isArray(embed) ? embed[0] : embed)
    ?.access_token_enc;
  const tokenEnc = data.access_token_enc ?? tenantToken ?? null;
  if (!tokenEnc) return null;

  try {
    return {
      phoneNumberId: data.phone_number_id,
      accessToken: decrypt(tokenEnc),
      wabaId: data.waba_id ?? null,
      source: 'tenant',
    };
  } catch {
    console.error('[credentials] could not decrypt the number token');
    return null;
  }
}

export async function loadWhatsAppCredentials(
  supabase: SupabaseClient,
  userId: string,
  tenantId?: string | null
): Promise<WhatsAppCredentials | null> {
  const fromTenant = await loadTenantCredentials(
    supabase,
    userId,
    tenantId ?? null
  );
  if (fromTenant) return fromTenant;
  return loadLegacyCredentials(supabase, userId);
}
