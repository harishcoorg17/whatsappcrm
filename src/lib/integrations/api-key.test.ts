import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  authenticateApiKey,
  extractBearerKey,
  generateApiKey,
  hashApiKey,
} from './api-key';

describe('generateApiKey', () => {
  it('makes a prefixed, high-entropy key with its prefix and hash', () => {
    const { key, prefix, hash } = generateApiKey();
    expect(key).toMatch(/^amst_live_[A-Za-z0-9_-]{43}$/);
    expect(key.startsWith(prefix)).toBe(true);
    expect(prefix.length).toBeLessThan(key.length);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashApiKey(key));
  });

  it('never returns the same key twice', () => {
    expect(generateApiKey().key).not.toBe(generateApiKey().key);
  });

  it('does not put the secret part in the prefix shown in the UI', () => {
    const { key, prefix } = generateApiKey();
    expect(key.slice(prefix.length).length).toBeGreaterThan(30);
  });
});

describe('hashApiKey', () => {
  it('is deterministic and does not contain the key', () => {
    const key = 'amst_live_abc';
    expect(hashApiKey(key)).toBe(hashApiKey(key));
    expect(hashApiKey(key)).not.toContain('abc');
  });

  it('differs for different keys', () => {
    expect(hashApiKey('amst_live_a')).not.toBe(hashApiKey('amst_live_b'));
  });
});

describe('extractBearerKey', () => {
  it('reads a Bearer key', () => {
    expect(extractBearerKey('Bearer amst_live_abc')).toBe('amst_live_abc');
  });

  it('accepts the scheme in any case and trims spaces', () => {
    expect(extractBearerKey('  bearer   amst_live_abc  ')).toBe(
      'amst_live_abc'
    );
  });

  it.each([
    null,
    undefined,
    '',
    'amst_live_abc',
    'Basic amst_live_abc',
    'Bearer',
    'Bearer sk_other_abc',
  ])('rejects %s', (header) => {
    expect(extractBearerKey(header as string | null | undefined)).toBeNull();
  });
});

interface KeyRow {
  id: string;
  tenant_id: string;
  crm_tenants: { id: string; status: string; owner_user_id: string | null };
}

const state: {
  byHash: Record<string, KeyRow | null>;
  updates: Array<{ id: string; values: Record<string, unknown> }>;
  lookups: string[];
} = { byHash: {}, updates: [], lookups: [] };

function fakeDb() {
  return {
    from: (table: string) => {
      if (table !== 'crm_api_keys') throw new Error(`unexpected ${table}`);
      let lookupHash = '';
      const query = {
        select: () => query,
        eq: (column: string, value: string) => {
          if (column === 'key_hash') {
            lookupHash = value;
            state.lookups.push(value);
          }
          return query;
        },
        is: () => query,
        maybeSingle: async () => ({
          data: state.byHash[lookupHash] ?? null,
          error: null,
        }),
        update: (values: Record<string, unknown>) => ({
          eq: async (_column: string, id: string) => {
            state.updates.push({ id, values });
            return { error: null };
          },
        }),
      };
      return query;
    },
  } as unknown as SupabaseClient;
}

describe('authenticateApiKey', () => {
  const KEY = 'amst_live_validkey';

  beforeEach(() => {
    state.byHash = {
      [hashApiKey(KEY)]: {
        id: 'k1',
        tenant_id: 't1',
        crm_tenants: { id: 't1', status: 'active', owner_user_id: 'u1' },
      },
    };
    state.updates = [];
    state.lookups = [];
  });

  it('returns the tenant for a valid key and records the use', async () => {
    const result = await authenticateApiKey(fakeDb(), `Bearer ${KEY}`);
    expect(result).toEqual({
      keyId: 'k1',
      tenantId: 't1',
      ownerUserId: 'u1',
    });
    expect(state.updates[0]).toMatchObject({ id: 'k1' });
    expect(state.updates[0].values).toHaveProperty('last_used_at');
  });

  it('looks the key up by hash, never by the plaintext', async () => {
    await authenticateApiKey(fakeDb(), `Bearer ${KEY}`);
    expect(state.lookups).toEqual([hashApiKey(KEY)]);
  });

  it('rejects an unknown key', async () => {
    expect(
      await authenticateApiKey(fakeDb(), 'Bearer amst_live_nope')
    ).toBeNull();
  });

  it('rejects a missing or malformed header without touching the database', async () => {
    expect(await authenticateApiKey(fakeDb(), null)).toBeNull();
    expect(await authenticateApiKey(fakeDb(), 'Basic abc')).toBeNull();
    expect(state.lookups).toHaveLength(0);
  });

  it('rejects a key whose tenant is not active', async () => {
    state.byHash[hashApiKey(KEY)]!.crm_tenants.status = 'suspended';
    expect(await authenticateApiKey(fakeDb(), `Bearer ${KEY}`)).toBeNull();
  });

  it('rejects a key whose tenant has no owner', async () => {
    state.byHash[hashApiKey(KEY)]!.crm_tenants.owner_user_id = null;
    expect(await authenticateApiKey(fakeDb(), `Bearer ${KEY}`)).toBeNull();
  });
});
