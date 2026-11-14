import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetRateLimitForTests } from '@/lib/rate-limit';

interface FakeState {
  userId: string | null;
  isPlatformAdmin: boolean;
  tenant: {
    id: string;
    owner_user_id: string | null;
    phone_number_id: string | null;
    waba_id: string | null;
    access_token_enc: string | null;
  } | null;
  /** phone_number_id -> owning tenant id, across crm_tenant_numbers. */
  numberOwners: Record<string, string>;
  /** phone_number_id -> tenant id on crm_tenants (primary mirror). */
  tenantPrimaries: Record<string, string>;
  numberCount: number;
  metaFails: boolean;
  inserted: Array<Record<string, unknown>>;
  tenantUpdates: Array<Record<string, unknown>>;
}

const state: FakeState = {
  userId: 'owner1',
  isPlatformAdmin: false,
  tenant: null,
  numberOwners: {},
  tenantPrimaries: {},
  numberCount: 1,
  metaFails: false,
  inserted: [],
  tenantUpdates: [],
};

const SAVED_ROW = {
  id: 'n2',
  phone_number_id: '222222222222',
  waba_id: 'waba-1',
  label: 'Sales',
  display_phone_number: '+91 90000 00002',
  is_primary: false,
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  access_token_enc: null,
};

function chain(resolve: (filters: Record<string, unknown>) => unknown) {
  const filters: Record<string, unknown> = {};
  const query: Record<string, unknown> = {};
  const self = () => query;
  query.select = (_c?: string, opts?: { head?: boolean }) => {
    if (opts?.head) filters.__count = true;
    return query;
  };
  query.eq = (column: string, value: unknown) => {
    filters[column] = value;
    return query;
  };
  query.order = self;
  query.maybeSingle = async () => resolve(filters);
  query.single = async () => resolve(filters);
  query.then = (onFulfilled: (v: unknown) => unknown) =>
    Promise.resolve(resolve(filters)).then(onFulfilled);
  return query;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: state.userId ? { id: state.userId } : null },
      }),
    },
  }),
}));

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'crm_platform_admins') {
        return chain(() => ({
          data: state.isPlatformAdmin ? { user_id: state.userId } : null,
          error: null,
        }));
      }
      if (table === 'crm_tenants') {
        const q = chain((filters) => {
          if ('phone_number_id' in filters) {
            const id = state.tenantPrimaries[filters.phone_number_id as string];
            return { data: id ? { id } : null, error: null };
          }
          return { data: state.tenant, error: null };
        });
        q.update = (values: Record<string, unknown>) => {
          state.tenantUpdates.push(values);
          return q;
        };
        return q;
      }
      // crm_tenant_numbers
      const q = chain((filters) => {
        if (filters.__count) return { count: state.numberCount, error: null };
        if ('phone_number_id' in filters) {
          const tenantId =
            state.numberOwners[filters.phone_number_id as string];
          return {
            data: tenantId ? { tenant_id: tenantId } : null,
            error: null,
          };
        }
        return { data: [SAVED_ROW], error: null };
      });
      q.insert = (values: Record<string, unknown>) => {
        state.inserted.push(values);
        const inserted = chain(() => ({ data: SAVED_ROW, error: null }));
        return inserted;
      };
      q.update = () => chain(() => ({ data: SAVED_ROW, error: null }));
      return q;
    },
  }),
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (value: string) => value.replace(/^enc\((.*)\)$/, '$1'),
  encrypt: (value: string) => `enc(${value})`,
}));

vi.mock('@/lib/whatsapp/meta-api', () => ({
  verifyPhoneNumber: vi.fn(async () => {
    if (state.metaFails) throw new Error('Invalid OAuth access token');
    return {
      id: '222222222222',
      display_phone_number: '+91 90000 00002',
      verified_name: 'Amstago Sales',
    };
  }),
}));

import { GET, POST } from './route';

const PARAMS = { params: Promise.resolve({ slug: 'amstago' }) };

function post(body: unknown) {
  return POST(
    new NextRequest('http://localhost/api/tenants/amstago/numbers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    PARAMS
  );
}

beforeEach(() => {
  __resetRateLimitForTests();
  state.userId = 'owner1';
  state.isPlatformAdmin = false;
  state.tenant = {
    id: 't1',
    owner_user_id: 'owner1',
    phone_number_id: '111111111111',
    waba_id: 'waba-1',
    access_token_enc: 'enc(tenant-token)',
  };
  state.numberOwners = { '111111111111': 't1' };
  state.tenantPrimaries = { '111111111111': 't1' };
  state.numberCount = 1;
  state.metaFails = false;
  state.inserted = [];
  state.tenantUpdates = [];
});

describe('GET /api/tenants/[slug]/numbers', () => {
  it('lists numbers without exposing tokens', async () => {
    const res = await GET(new NextRequest('http://localhost/x'), PARAMS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      numbers: Array<Record<string, unknown>>;
    };
    expect(body.numbers[0]).toMatchObject({
      phone_number_id: '222222222222',
      has_own_token: false,
    });
    expect(JSON.stringify(body)).not.toContain('access_token');
  });

  it('rejects users who do not own the tenant', async () => {
    state.userId = 'stranger';
    const res = await GET(new NextRequest('http://localhost/x'), PARAMS);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/tenants/[slug]/numbers', () => {
  it('rejects unauthenticated requests', async () => {
    state.userId = null;
    expect((await post({ phoneNumberId: '222222222222' })).status).toBe(401);
  });

  it('rejects a malformed Phone Number ID', async () => {
    expect((await post({ phoneNumberId: 'abc' })).status).toBe(400);
    expect(state.inserted).toEqual([]);
  });

  it('refuses a number Meta cannot verify', async () => {
    state.metaFails = true;
    const res = await post({ phoneNumberId: '222222222222' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain(
      'Meta could not verify'
    );
    expect(state.inserted).toEqual([]);
  });

  it('refuses a number that belongs to another tenant', async () => {
    state.numberOwners['222222222222'] = 'other-tenant';
    const res = await post({ phoneNumberId: '222222222222' });
    expect(res.status).toBe(409);
    expect(state.inserted).toEqual([]);
  });

  it('refuses a number already on this tenant', async () => {
    state.numberOwners['222222222222'] = 't1';
    expect((await post({ phoneNumberId: '222222222222' })).status).toBe(409);
  });

  it('enforces the per-tenant number limit', async () => {
    state.numberCount = 20;
    expect((await post({ phoneNumberId: '222222222222' })).status).toBe(400);
  });

  it('adds a secondary number that shares the tenant token', async () => {
    const res = await post({ phoneNumberId: '222222222222', label: 'Sales' });
    expect(res.status).toBe(201);
    expect(state.inserted[0]).toMatchObject({
      tenant_id: 't1',
      phone_number_id: '222222222222',
      is_primary: false,
      access_token_enc: null,
    });
    expect(state.tenantUpdates).toEqual([]);
  });

  it('encrypts a number-specific token and never echoes it', async () => {
    const res = await post({
      phoneNumberId: '222222222222',
      accessToken: 'secret-token',
    });
    expect(res.status).toBe(201);
    expect(state.inserted[0].access_token_enc).toBe('enc(secret-token)');
    expect(JSON.stringify(await res.json())).not.toContain('secret-token');
  });

  it('makes the first number the tenant primary', async () => {
    state.tenant = { ...state.tenant!, phone_number_id: null };
    state.tenantPrimaries = {};
    state.numberOwners = {};
    const res = await post({ phoneNumberId: '222222222222' });
    expect(res.status).toBe(201);
    expect(state.tenantUpdates[0]).toMatchObject({
      phone_number_id: '222222222222',
    });
    expect(state.inserted).toEqual([]);
  });
});
