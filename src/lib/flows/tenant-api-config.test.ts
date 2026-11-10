import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (value: string) => {
    if (value === 'broken') throw new Error('bad cipher');
    return value.replace(/^enc\((.*)\)$/, '$1');
  },
}));

import { loadTenantApiConfig } from './tenant-api';

interface FakeRows {
  conversation: { tenant_id: string | null } | null;
  tenant: {
    data_api_url: string | null;
    data_api_config: Record<string, unknown> | null;
  } | null;
}

function fakeDb(rows: FakeRows) {
  return {
    from: (table: string) => {
      const row = table === 'conversations' ? rows.conversation : rows.tenant;
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: row, error: null }),
      };
      return query;
    },
  } as unknown as SupabaseClient;
}

const WITH_KEY = {
  conversation: { tenant_id: 't1' },
  tenant: {
    data_api_url: 'https://API.example.com/api/',
    data_api_config: { api_key_enc: 'enc(integration-secret)' },
  },
};

describe('loadTenantApiConfig', () => {
  it('returns the normalised base and the decrypted key', async () => {
    expect(await loadTenantApiConfig(fakeDb(WITH_KEY), 'c1')).toEqual({
      apiBase: 'https://api.example.com/api',
      apiKey: 'integration-secret',
    });
  });

  it('returns null without a conversation', async () => {
    expect(await loadTenantApiConfig(fakeDb(WITH_KEY), null)).toBeNull();
  });

  it('returns null for a conversation without a tenant', async () => {
    expect(
      await loadTenantApiConfig(
        fakeDb({ ...WITH_KEY, conversation: { tenant_id: null } }),
        'c1'
      )
    ).toBeNull();
  });

  it('returns null when the tenant has no API address', async () => {
    expect(
      await loadTenantApiConfig(
        fakeDb({
          ...WITH_KEY,
          tenant: {
            data_api_url: null,
            data_api_config: WITH_KEY.tenant.data_api_config,
          },
        }),
        'c1'
      )
    ).toBeNull();
  });

  it('returns null when no key has been saved', async () => {
    expect(
      await loadTenantApiConfig(
        fakeDb({
          ...WITH_KEY,
          tenant: { ...WITH_KEY.tenant, data_api_config: null },
        }),
        'c1'
      )
    ).toBeNull();
    expect(
      await loadTenantApiConfig(
        fakeDb({
          ...WITH_KEY,
          tenant: { ...WITH_KEY.tenant, data_api_config: {} },
        }),
        'c1'
      )
    ).toBeNull();
  });

  it('returns null when the key cannot be decrypted', async () => {
    expect(
      await loadTenantApiConfig(
        fakeDb({
          ...WITH_KEY,
          tenant: {
            ...WITH_KEY.tenant,
            data_api_config: { api_key_enc: 'broken' },
          },
        }),
        'c1'
      )
    ).toBeNull();
  });

  it('returns null when the stored address breaks the URL rules', async () => {
    expect(
      await loadTenantApiConfig(
        fakeDb({
          ...WITH_KEY,
          tenant: {
            ...WITH_KEY.tenant,
            data_api_url: 'https://169.254.169.254/x',
          },
        }),
        'c1'
      )
    ).toBeNull();
  });
});
