import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCredentialsForConversation } from './credentials';

vi.mock('./encryption', () => ({
  decrypt: (value: string) => value.replace(/^enc\((.*)\)$/, '$1'),
  encrypt: (value: string) => `enc(${value})`,
  isLegacyFormat: () => false,
}));

interface NumberRow {
  phone_number_id: string;
  waba_id: string | null;
  access_token_enc: string | null;
  tenant_id: string;
  status: 'active' | 'disabled';
  tenantStatus: 'active' | 'suspended';
  tenantTokenEnc: string | null;
}

interface FakeState {
  conversation: {
    tenant_id: string | null;
    phone_number_id: string | null;
  } | null;
  /** Simulates migration 028 not applied: the number column does not exist. */
  numberColumnMissing: boolean;
  numbers: NumberRow[];
  primary: {
    phone_number_id: string;
    waba_id: string;
    access_token_enc: string;
  };
}

const state: FakeState = {
  conversation: null,
  numberColumnMissing: false,
  numbers: [],
  primary: {
    phone_number_id: 'PRIMARY',
    waba_id: 'waba-1',
    access_token_enc: 'enc(primary-token)',
  },
};

function conversationsQuery() {
  let selectedColumns = '';
  const query = {
    select: (columns: string) => {
      selectedColumns = columns;
      return query;
    },
    eq: () => query,
    maybeSingle: async () => {
      if (
        selectedColumns.includes('phone_number_id') &&
        state.numberColumnMissing
      ) {
        return {
          data: null,
          error: { message: 'column does not exist', code: '42703' },
        };
      }
      const row = state.conversation;
      if (!row) return { data: null, error: null };
      return {
        data: state.numberColumnMissing ? { tenant_id: row.tenant_id } : row,
        error: null,
      };
    },
  };
  return query;
}

function numbersQuery() {
  const filters: Record<string, unknown> = {};
  const query = {
    select: () => query,
    eq: (column: string, value: unknown) => {
      filters[column] = value;
      return query;
    },
    maybeSingle: async () => {
      const row = state.numbers.find(
        (n) =>
          n.tenant_id === filters.tenant_id &&
          n.phone_number_id === filters.phone_number_id &&
          n.status === filters.status &&
          n.tenantStatus === filters['crm_tenants.status']
      );
      if (!row) return { data: null, error: null };
      return {
        data: {
          phone_number_id: row.phone_number_id,
          waba_id: row.waba_id,
          access_token_enc: row.access_token_enc,
          crm_tenants: {
            status: row.tenantStatus,
            access_token_enc: row.tenantTokenEnc,
          },
        },
        error: null,
      };
    },
  };
  return query;
}

function tenantsQuery() {
  const query = {
    select: () => query,
    not: () => query,
    order: () => query,
    limit: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: state.primary, error: null }),
  };
  return query;
}

const supabase = {
  from: (table: string) => {
    if (table === 'conversations') return conversationsQuery();
    if (table === 'crm_tenant_numbers') return numbersQuery();
    if (table === 'crm_tenants') return tenantsQuery();
    throw new Error(`unexpected table ${table}`);
  },
} as unknown as SupabaseClient;

const NUMBER_B: NumberRow = {
  phone_number_id: 'NUMBER-B',
  waba_id: 'waba-2',
  access_token_enc: 'enc(b-token)',
  tenant_id: 't1',
  status: 'active',
  tenantStatus: 'active',
  tenantTokenEnc: 'enc(primary-token)',
};

beforeEach(() => {
  state.conversation = { tenant_id: 't1', phone_number_id: 'NUMBER-B' };
  state.numberColumnMissing = false;
  state.numbers = [{ ...NUMBER_B }];
});

describe('loadCredentialsForConversation with several numbers', () => {
  it('replies from the number the conversation is on', async () => {
    const creds = await loadCredentialsForConversation(supabase, 'u1', 'c1');
    expect(creds).toMatchObject({
      phoneNumberId: 'NUMBER-B',
      accessToken: 'b-token',
      wabaId: 'waba-2',
    });
  });

  it('shares the tenant token when the number has none of its own', async () => {
    state.numbers = [{ ...NUMBER_B, access_token_enc: null }];
    const creds = await loadCredentialsForConversation(supabase, 'u1', 'c1');
    expect(creds).toMatchObject({
      phoneNumberId: 'NUMBER-B',
      accessToken: 'primary-token',
    });
  });

  it('falls back to the primary when the number is disabled', async () => {
    state.numbers = [{ ...NUMBER_B, status: 'disabled' }];
    const creds = await loadCredentialsForConversation(supabase, 'u1', 'c1');
    expect(creds?.phoneNumberId).toBe('PRIMARY');
  });

  it('falls back to the primary when the number belongs to another tenant', async () => {
    state.numbers = [{ ...NUMBER_B, tenant_id: 'other' }];
    const creds = await loadCredentialsForConversation(supabase, 'u1', 'c1');
    expect(creds?.phoneNumberId).toBe('PRIMARY');
  });

  it('does not send through a suspended tenant number', async () => {
    state.numbers = [{ ...NUMBER_B, tenantStatus: 'suspended' }];
    const creds = await loadCredentialsForConversation(supabase, 'u1', 'c1');
    expect(creds?.phoneNumberId).toBe('PRIMARY');
  });

  it('uses the primary for conversations that have no number yet', async () => {
    state.conversation = { tenant_id: 't1', phone_number_id: null };
    const creds = await loadCredentialsForConversation(supabase, 'u1', 'c1');
    expect(creds?.phoneNumberId).toBe('PRIMARY');
  });

  it('keeps working before migration 028 adds the number column', async () => {
    state.numberColumnMissing = true;
    const creds = await loadCredentialsForConversation(supabase, 'u1', 'c1');
    expect(creds?.phoneNumberId).toBe('PRIMARY');
  });
});
