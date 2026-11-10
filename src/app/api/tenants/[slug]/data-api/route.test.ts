import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetRateLimitForTests } from '@/lib/rate-limit';

interface FakeState {
  userId: string | null;
  tenant: { id: string; owner_user_id: string | null } | null;
  isPlatformAdmin: boolean;
  updates: Array<Record<string, unknown>>;
  updateError: string | null;
}

const state: FakeState = {
  userId: 'u1',
  tenant: { id: 't1', owner_user_id: 'u1' },
  isPlatformAdmin: false,
  updates: [],
  updateError: null,
};

function tenantsQuery() {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: state.tenant, error: null }),
    update: (values: Record<string, unknown>) => {
      state.updates.push(values);
      return {
        eq: async () => ({
          error: state.updateError ? { message: state.updateError } : null,
        }),
      };
    },
  };
  return query;
}

function adminsQuery() {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({
      data: state.isPlatformAdmin ? { user_id: state.userId } : null,
      error: null,
    }),
  };
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
    from: (table: string) =>
      table === 'crm_platform_admins' ? adminsQuery() : tenantsQuery(),
  }),
}));

async function put(body: Record<string, unknown> | null) {
  const { PUT } = await import('./route');
  return PUT(
    new NextRequest('http://localhost/api/tenants/acme/data-api', {
      method: 'PUT',
      body: body === null ? 'not json' : JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug: 'acme' }) }
  );
}

beforeEach(() => {
  __resetRateLimitForTests();
  Object.assign(state, {
    userId: 'u1',
    tenant: { id: 't1', owner_user_id: 'u1' },
    isPlatformAdmin: false,
    updates: [],
    updateError: null,
  });
});

describe('PUT /api/tenants/[slug]/data-api', () => {
  it('rejects a request with no session', async () => {
    state.userId = null;
    expect((await put({ url: 'https://api.example.com' })).status).toBe(401);
    expect(state.updates).toHaveLength(0);
  });

  it('returns 404 for an unknown tenant', async () => {
    state.tenant = null;
    expect((await put({ url: 'https://api.example.com' })).status).toBe(404);
  });

  it('refuses someone who neither owns the tenant nor is a platform admin', async () => {
    state.tenant = { id: 't1', owner_user_id: 'someone-else' };
    const res = await put({ url: 'https://api.example.com' });
    expect(res.status).toBe(403);
    expect(state.updates).toHaveLength(0);
  });

  it('lets a platform admin set another owner’s tenant', async () => {
    state.tenant = { id: 't1', owner_user_id: 'someone-else' };
    state.isPlatformAdmin = true;
    const res = await put({ url: 'https://api.example.com/api' });
    expect(res.status).toBe(200);
    expect(state.updates).toEqual([
      { data_api_url: 'https://api.example.com/api' },
    ]);
  });

  it('rejects an unreadable body', async () => {
    expect((await put(null)).status).toBe(400);
  });

  it('rejects an address that breaks the URL rules, without saving', async () => {
    const res = await put({ url: 'http://169.254.169.254/latest' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/https/i);
    expect(state.updates).toHaveLength(0);
  });

  it('saves the normalised address for the owner', async () => {
    const res = await put({ url: '  https://API.Example.com/api/  ' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data_api_url: 'https://api.example.com/api',
    });
    expect(state.updates).toEqual([
      { data_api_url: 'https://api.example.com/api' },
    ]);
  });

  it('clears the address when the url is empty', async () => {
    const res = await put({ url: '   ' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data_api_url: null });
    expect(state.updates).toEqual([{ data_api_url: null }]);
  });

  it('reports a failed save', async () => {
    state.updateError = 'boom';
    const res = await put({ url: 'https://api.example.com' });
    expect(res.status).toBe(500);
  });
});
