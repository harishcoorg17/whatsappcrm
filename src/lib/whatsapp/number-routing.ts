import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Which tenant owns an inbound WhatsApp number.
 *
 * A tenant can have several numbers (crm_tenant_numbers). The primary number
 * is also mirrored on crm_tenants, so if the numbers table is missing or empty
 * (migration 028 not applied yet) we fall back to that single-number lookup
 * instead of dropping the customer's message.
 */

export interface TenantRoute {
  tenantId: string;
  ownerUserId: string | null;
  /** Encrypted token to use for this number; null when none is stored. */
  accessTokenEnc: string | null;
}

interface TenantEmbed {
  id: string;
  owner_user_id: string | null;
  access_token_enc: string | null;
}

interface NumberRow {
  access_token_enc: string | null;
  crm_tenants: TenantEmbed | TenantEmbed[] | null;
}

function firstTenant(embed: NumberRow['crm_tenants']): TenantEmbed | null {
  if (!embed) return null;
  return Array.isArray(embed) ? (embed[0] ?? null) : embed;
}

export async function resolveTenantRoute(
  db: SupabaseClient,
  phoneNumberId: string
): Promise<TenantRoute | null> {
  const { data, error } = await db
    .from('crm_tenant_numbers')
    .select(
      'access_token_enc, crm_tenants!inner(id, owner_user_id, access_token_enc)'
    )
    .eq('phone_number_id', phoneNumberId)
    .eq('status', 'active')
    .eq('crm_tenants.status', 'active')
    .maybeSingle();

  if (!error && data) {
    const row = data as unknown as NumberRow;
    const tenant = firstTenant(row.crm_tenants);
    if (tenant) {
      return {
        tenantId: tenant.id,
        ownerUserId: tenant.owner_user_id ?? null,
        // Numbers under one business account often share the tenant's token.
        accessTokenEnc: row.access_token_enc ?? tenant.access_token_enc ?? null,
      };
    }
  }
  if (error) {
    console.warn(
      '[number-routing] numbers lookup failed, using tenant row:',
      error.message
    );
  }

  const { data: tenantRow } = await db
    .from('crm_tenants')
    .select('id, access_token_enc, owner_user_id')
    .eq('phone_number_id', phoneNumberId)
    .eq('status', 'active')
    .maybeSingle();

  if (!tenantRow) return null;
  return {
    tenantId: tenantRow.id,
    ownerUserId: tenantRow.owner_user_id ?? null,
    accessTokenEnc: tenantRow.access_token_enc ?? null,
  };
}
