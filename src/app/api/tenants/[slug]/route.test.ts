import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetRateLimitForTests } from '@/lib/rate-limit';

interface FakeState {
  userId: string | null;
  tenant: { id: string; name: string; owner_user_id: string | null } | null;
  isPlatformAdmin: boolean;
  deleteError: { code?: string; message: string } | null;
  deletedIds: string[];
}

const state: FakeState = {
  userId: 'admin1',
  tenant: { id: 't1', name: 'Amstago Tours', owner_user_id: 'owner1' },
  isPlatformAdmin: true,
  deleteError: null,
  deletedIds: [],
};

function tenantsQuery() {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: state.tenant, error: null }),
    delete: () => ({
      eq: async (_column: string, id: string) => {
        if (!state.deleteError) state.deletedIds.push(id);
        return { error: state.deleteError };
      },
    }),
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

import { DELETE } from './route';

const PARAMS = { params: Promise.resolve({ slug: 'amstago-tours' }) };

function call(body?: unknown) {
  return DELETE(
    new NextRequest('http://localhost/api/tenants/amstago-tours', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    PARAMS
  );
}

beforeEach(() => {
  __resetRateLimitForTests();
  state.userId = 'admin1';
  state.tenant = { id: 't1', name: 'Amstago Tours', owner_user_id: 'owner1' };
  state.isPlatformAdmin = true;
  state.deleteError = null;
  state.deletedIds = [];
});

describe('DELETE /api/tenants/[slug]', () => {
  it('rejects unauthenticated requests', async () => {
    state.userId = null;
    expect((await call({ confirmSlug: 'amstago-tours' })).status).toBe(401);
    expect(state.deletedIds).toEqual([]);
  });

  it('rejects non platform admins, including the tenant owner', async () => {
    state.userId = 'owner1';
    state.isPlatformAdmin = false;
    expect((await call({ confirmSlug: 'amstago-tours' })).status).toBe(403);
    expect(state.deletedIds).toEqual([]);
  });

  it('requires the slug to be repeated as confirmation', async () => {
    expect((await call({ confirmSlug: 'wrong' })).status).toBe(400);
    expect((await call({})).status).toBe(400);
    expect((await call()).status).toBe(400);
    expect(state.deletedIds).toEqual([]);
  });

  it('returns 404 when the tenant does not exist', async () => {
    state.tenant = null;
    expect((await call({ confirmSlug: 'amstago-tours' })).status).toBe(404);
  });

  it('deletes the tenant when a platform admin confirms the slug', async () => {
    const res = await call({ confirmSlug: 'amstago-tours' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true, slug: 'amstago-tours' });
    expect(state.deletedIds).toEqual(['t1']);
  });

  it('returns 409 when linked records block the delete', async () => {
    state.deleteError = { code: '23503', message: 'fk violation' };
    expect((await call({ confirmSlug: 'amstago-tours' })).status).toBe(409);
  });

  it('returns 500 on other database errors', async () => {
    state.deleteError = { message: 'boom' };
    expect((await call({ confirmSlug: 'amstago-tours' })).status).toBe(500);
  });
});
