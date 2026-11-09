import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWhatsAppCredentials } from './credentials';

vi.mock('./encryption', () => ({
  decrypt: (value: string) => {
    if (value === 'broken') throw new Error('bad cipher');
    return value.replace(/^(enc|legacy)\((.*)\)$/, '$2');
  },
  encrypt: (value: string) => `enc(${value})`,
  isLegacyFormat: (value: string) => value.startsWith('legacy('),
}));

interface TenantRow {
  phone_number_id: string | null;
  waba_id: string | null;
  access_token_enc: string | null;
}

interface FakeState {
  tenant: TenantRow | null;
  tenantError: string | null;
  legacy: Record<string, unknown> | null;
  tenantFilters: Array<[string, unknown]>;
  legacyUpdates: Array<Record<string, unknown>>;
}

const state: FakeState = {
  tenant: null,
  tenantError: null,
  legacy: null,
  tenantFilters: [],
  legacyUpdates: [],
};

function tenantQuery() {
  const query = {
    select: () => query,
    not: () => query,
    eq: (column: string, value: unknown) => {
      state.tenantFilters.push([column, value]);
      return query;
    },
    order: () => query,
    limit: () => query,
    maybeSingle: async () =>
      state.tenantError
        ? { data: null, error: { message: state.tenantError } }
        : { data: state.tenant, error: null },
  };
  return query;
}

function legacyQuery() {
  const query = {
    select: () => query,
    eq: () => query,
    update: (values: Record<string, unknown>) => {
      state.legacyUpdates.push(values);
      return query;
    },
    maybeSingle: async () => ({ data: state.legacy, error: null }),
    then: (resolve: (value: { error: null }) => void) =>
      resolve({ error: null }),
  };
  return query;
}

const supabase = {
  from: (table: string) =>
    table === 'crm_tenants' ? tenantQuery() : legacyQuery(),
} as unknown as SupabaseClient;

beforeEach(() => {
  Object.assign(state, {
    tenant: null,
    tenantError: null,
    legacy: null,
    tenantFilters: [],
    legacyUpdates: [],
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('loadWhatsAppCredentials', () => {
  it('uses the connection saved on a tenant the user owns', async () => {
    state.tenant = {
      phone_number_id: 'p1',
      waba_id: 'w1',
      access_token_enc: 'enc(tok)',
    };
    const creds = await loadWhatsAppCredentials(supabase, 'u1');
    expect(creds).toMatchObject({
      phoneNumberId: 'p1',
      accessToken: 'tok',
      wabaId: 'w1',
      source: 'tenant',
    });
    expect(state.tenantFilters).toContainEqual(['owner_user_id', 'u1']);
  });

  it("uses the conversation's own tenant when one is given", async () => {
    state.tenant = {
      phone_number_id: 'p2',
      waba_id: null,
      access_token_enc: 'enc(tok2)',
    };
    const creds = await loadWhatsAppCredentials(supabase, 'u1', 't2');
    expect(creds?.phoneNumberId).toBe('p2');
    expect(state.tenantFilters).toContainEqual(['id', 't2']);
    expect(state.tenantFilters).not.toContainEqual(['owner_user_id', 'u1']);
  });

  it('falls back to the legacy per-user config when no tenant is connected', async () => {
    state.legacy = {
      id: 'cfg1',
      phone_number_id: 'p9',
      waba_id: 'w9',
      access_token: 'enc(old)',
    };
    const creds = await loadWhatsAppCredentials(supabase, 'u1');
    expect(creds).toMatchObject({
      phoneNumberId: 'p9',
      accessToken: 'old',
      source: 'legacy',
    });
    expect(creds?.upgradeLegacyToken).toBeUndefined();
  });

  it('returns null when nothing is connected anywhere', async () => {
    expect(await loadWhatsAppCredentials(supabase, 'u1')).toBeNull();
  });

  it('falls back to the legacy config if the tenant lookup fails', async () => {
    state.tenantError = 'boom';
    state.legacy = {
      id: 'cfg1',
      phone_number_id: 'p9',
      access_token: 'enc(old)',
    };
    const creds = await loadWhatsAppCredentials(supabase, 'u1');
    expect(creds?.source).toBe('legacy');
  });

  it('ignores a tenant whose token cannot be decrypted', async () => {
    state.tenant = {
      phone_number_id: 'p1',
      waba_id: null,
      access_token_enc: 'broken',
    };
    expect(await loadWhatsAppCredentials(supabase, 'u1')).toBeNull();
  });

  it('offers an upgrade only for legacy tokens in the old format', async () => {
    state.legacy = {
      id: 'cfg1',
      phone_number_id: 'p9',
      access_token: 'legacy(old)',
    };
    const creds = await loadWhatsAppCredentials(supabase, 'u1');
    expect(creds?.upgradeLegacyToken).toBeTypeOf('function');
    await creds?.upgradeLegacyToken?.();
    expect(state.legacyUpdates).toEqual([{ access_token: 'enc(old)' }]);
  });
});
