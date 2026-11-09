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
