/**
 * Server-only helpers for the per-tenant backend API used by `http_fetch`.
 *
 * Kept out of http-fetch.ts because that module is also imported by the
 * client-side validator, and `node:dns` must never reach the browser bundle.
 */

import { lookup } from 'node:dns/promises';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';
import { isPublicIp, normalizeDataApiUrl } from './data-api-url';

/**
 * True only if the host resolves, and every address it resolves to is public.
 * A tenant-controlled DNS name must not be able to reach internal services.
 */
export async function publicHostGuard(host: string): Promise<boolean> {
  try {
    const addresses = await lookup(host, { all: true });
    return (
      addresses.length > 0 &&
      addresses.every(({ address }) => isPublicIp(address))
    );
  } catch {
    return false;
  }
}

/**
 * The tenant's API address AND the secret key the CRM sends to it, for
 * endpoints that are not public (such as the customer lookup). Null unless
 * both are set and valid; the key is stored encrypted and only decrypted here.
 */
export async function loadTenantApiConfig(
  db: SupabaseClient,
  conversationId: string | null
): Promise<{ apiBase: string; apiKey: string } | null> {
  if (!conversationId) return null;

  const { data: conversation } = await db
    .from('conversations')
    .select('tenant_id')
    .eq('id', conversationId)
    .maybeSingle();
  const tenantId = (conversation as { tenant_id: string | null } | null)
    ?.tenant_id;
  if (!tenantId) return null;

  const { data: tenant } = await db
    .from('crm_tenants')
    .select('data_api_url, data_api_config')
    .eq('id', tenantId)
    .maybeSingle();
  const row = tenant as {
    data_api_url: string | null;
    data_api_config: Record<string, unknown> | null;
  } | null;
  if (!row?.data_api_url) return null;

  const normalised = normalizeDataApiUrl(row.data_api_url);
  if (!normalised.ok) return null;

  const encrypted = row.data_api_config?.api_key_enc;
  if (typeof encrypted !== 'string' || encrypted === '') return null;
  try {
    return { apiBase: normalised.url, apiKey: decrypt(encrypted) };
  } catch {
    console.error('[tenant-api] could not decrypt the tenant API key');
    return null;
  }
}

/**
 * The API base of the tenant a conversation belongs to, or null when the
 * conversation has no tenant, the tenant has none configured, or the stored
 * value no longer passes the URL rules (for example if it was edited directly
 * in the database).
 */
export async function loadTenantApiBase(
  db: SupabaseClient,
  conversationId: string | null
): Promise<string | null> {
  if (!conversationId) return null;

  const { data: conversation } = await db
    .from('conversations')
    .select('tenant_id')
    .eq('id', conversationId)
    .maybeSingle();
  const tenantId = (conversation as { tenant_id: string | null } | null)
    ?.tenant_id;
  if (!tenantId) return null;

  const { data: tenant } = await db
    .from('crm_tenants')
    .select('data_api_url')
    .eq('id', tenantId)
    .maybeSingle();
  const stored = (tenant as { data_api_url: string | null } | null)
    ?.data_api_url;
  if (!stored) return null;

  const normalised = normalizeDataApiUrl(stored);
  return normalised.ok ? normalised.url : null;
}
