import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCredentialsForConversation } from './credentials';

vi.mock('./encryption', () => ({
  decrypt: (value: string) => value.replace(/^enc\((.*)\)$/, '$1'),
  encrypt: (value: string) => `enc(${value})`,
  isLegacyFormat: () => false,
}));

interface FakeState {
  conversationTenantId: string | null;
  conversationFound: boolean;
  tenants: Record<
    string,
    {
      phone_number_id: string;
      waba_id: string;
      access_token_enc: string;
    }
  >;
  legacy: Record<string, unknown> | null;
  conversationFilters: Array<[string, unknown]>;
}

const state: FakeState = {
  conversationTenantId: null,
  conversationFound: true,
  tenants: {},
  legacy: null,
  conversationFilters: [],
};

function conversationsQuery() {
  const query = {
    select: () => query,
    eq: (column: string, value: unknown) => {
      state.conversationFilters.push([column, value]);
      return query;
    },
    maybeSingle: async () => ({
      data: state.conversationFound
        ? { tenant_id: state.conversationTenantId }
        : null,
      error: null,
    }),
  };
  return query;
}

function tenantsQuery() {
  let tenantId: string | null = null;
  const query = {
    select: () => query,
    not: () => query,
    order: () => query,
    limit: () => query,
    eq: (column: string, value: unknown) => {
      if (column === 'id') tenantId = value as string;
      return query;
    },
    maybeSingle: async () => ({
      data: tenantId ? (state.tenants[tenantId] ?? null) : null,
      error: null,
    }),
  };
  return query;
}

function legacyQuery() {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: state.legacy, error: null }),
  };
  return query;
}

const supabase = {
  from: (table: string) => {
    if (table === 'conversations') return conversationsQuery();
    if (table === 'crm_tenants') return tenantsQuery();
    return legacyQuery();
  },
} as unknown as SupabaseClient;

beforeEach(() => {
  Object.assign(state, {
    conversationTenantId: null,
    conversationFound: true,
    tenants: {},
    legacy: null,
    conversationFilters: [],
  });
});

describe('loadCredentialsForConversation', () => {
  it("uses the credentials of the conversation's own tenant", async () => {
    state.conversationTenantId = 't-amstago';
    state.tenants = {
      't-amstago': {
        phone_number_id: 'pn-amstago',
        waba_id: 'waba-amstago',
        access_token_enc: 'enc(token-amstago)',
      },
      't-other': {
        phone_number_id: 'pn-other',
        waba_id: 'waba-other',
        access_token_enc: 'enc(token-other)',
      },
    };

    const credentials = await loadCredentialsForConversation(
      supabase,
      'u1',
      'c1'
    );

    expect(credentials).toMatchObject({
      phoneNumberId: 'pn-amstago',
      accessToken: 'token-amstago',
      source: 'tenant',
    });
  });

  it('picks the right number when one user owns several tenants', async () => {
    state.tenants = {
      't-a': {
        phone_number_id: 'pn-a',
        waba_id: 'waba-a',
        access_token_enc: 'enc(token-a)',
      },
      't-b': {
        phone_number_id: 'pn-b',
        waba_id: 'waba-b',
        access_token_enc: 'enc(token-b)',
      },
    };

    state.conversationTenantId = 't-b';
    expect(
      (await loadCredentialsForConversation(supabase, 'u1', 'c1'))
        ?.phoneNumberId
    ).toBe('pn-b');

    state.conversationTenantId = 't-a';
    expect(
      (await loadCredentialsForConversation(supabase, 'u1', 'c2'))
        ?.phoneNumberId
    ).toBe('pn-a');
  });

  it('scopes the conversation lookup to the user', async () => {
    state.conversationTenantId = 't-a';
    state.tenants = {
      't-a': {
        phone_number_id: 'pn-a',
        waba_id: 'waba-a',
        access_token_enc: 'enc(token-a)',
      },
    };
    await loadCredentialsForConversation(supabase, 'u1', 'c1');
    expect(state.conversationFilters).toEqual(
      expect.arrayContaining([
        ['id', 'c1'],
        ['user_id', 'u1'],
      ])
    );
  });

  it('falls back to the legacy connection when the conversation has no tenant', async () => {
    state.conversationTenantId = null;
    state.legacy = {
      id: 'cfg1',
      phone_number_id: 'pn-legacy',
      waba_id: 'waba-legacy',
      access_token: 'enc(token-legacy)',
    };
    const credentials = await loadCredentialsForConversation(
      supabase,
      'u1',
      'c1'
    );
    expect(credentials).toMatchObject({
      phoneNumberId: 'pn-legacy',
      source: 'legacy',
    });
  });

  it('returns null when nothing is connected', async () => {
    expect(
      await loadCredentialsForConversation(supabase, 'u1', 'c1')
    ).toBeNull();
  });

  it('still resolves credentials when the conversation row is missing', async () => {
    state.conversationFound = false;
    state.legacy = {
      id: 'cfg1',
      phone_number_id: 'pn-legacy',
      waba_id: null,
      access_token: 'enc(token-legacy)',
    };
    expect(
      (await loadCredentialsForConversation(supabase, 'u1', 'c1'))
        ?.phoneNumberId
    ).toBe('pn-legacy');
  });
});
