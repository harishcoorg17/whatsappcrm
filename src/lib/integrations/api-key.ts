/**
 * Per-tenant API keys for server-to-server calls (for example the Amstago
 * backend asking the CRM to send a template).
 *
 * A key looks like `amst_live_<43 random chars>`. Only its SHA-256 hash is
 * stored; the plaintext is shown once when the key is created. The key
 * carries 256 bits of randomness, so a fast hash is appropriate here (a slow
 * password hash is for low-entropy secrets) and lets us look a key up by its
 * hash in one indexed query.
 */

import { createHash, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

const KEY_PREFIX = 'amst_live_';
const SECRET_BYTES = 32;
/** Characters of the key shown in the UI to recognise it (prefix + 4). */
const DISPLAY_PREFIX_LENGTH = KEY_PREFIX.length + 4;

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function generateApiKey(): {
  key: string;
  prefix: string;
  hash: string;
} {
  const key = `${KEY_PREFIX}${randomBytes(SECRET_BYTES).toString('base64url')}`;
  return {
    key,
    prefix: key.slice(0, DISPLAY_PREFIX_LENGTH),
    hash: hashApiKey(key),
  };
}

/** The key from an `Authorization: Bearer <key>` header, or null. */
export function extractBearerKey(
  header: string | null | undefined
): string | null {
  if (!header) return null;
  const match = /^\s*bearer\s+(\S+)\s*$/i.exec(header);
  if (!match) return null;
  return match[1].startsWith(KEY_PREFIX) ? match[1] : null;
}

export interface AuthenticatedKey {
  keyId: string;
  tenantId: string;
  ownerUserId: string;
}

interface KeyLookupRow {
  id: string;
  tenant_id: string;
  crm_tenants: {
    id: string;
    status: string;
    owner_user_id: string | null;
  } | null;
}

/**
 * Resolves a request's Authorization header to the tenant it may act for.
 * Null for a missing, malformed, unknown or revoked key, and for a key whose
 * tenant is suspended or has no owner (an unowned tenant has nobody whose
 * templates and contacts a send could belong to).
 */
export async function authenticateApiKey(
  db: SupabaseClient,
  authorization: string | null | undefined
): Promise<AuthenticatedKey | null> {
  const key = extractBearerKey(authorization);
  if (!key) return null;

  const { data, error } = await db
    .from('crm_api_keys')
    .select('id, tenant_id, crm_tenants(id, status, owner_user_id)')
    .eq('key_hash', hashApiKey(key))
    .is('revoked_at', null)
    .maybeSingle();

  const row = data as unknown as KeyLookupRow | null;
  if (error || !row?.crm_tenants) return null;
  if (row.crm_tenants.status !== 'active') return null;
  if (!row.crm_tenants.owner_user_id) return null;

  // Best effort: a failed bookkeeping write must not reject a valid key.
  try {
    await db
      .from('crm_api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', row.id);
  } catch {
    // ignored
  }

  return {
    keyId: row.id,
    tenantId: row.tenant_id,
    ownerUserId: row.crm_tenants.owner_user_id,
  };
}
