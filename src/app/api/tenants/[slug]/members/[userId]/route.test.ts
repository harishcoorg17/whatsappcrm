import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeState {
  userId: string | null;
  callerRole: 'admin' | 'agent' | null;
  target: { user_id: string; role: 'admin' | 'agent' } | null;
  roleUpdates: Array<Record<string, unknown>>;
  deletes: number;
  unassigns: Array<Record<string, unknown>>;
}

const state: FakeState = {
  userId: 'owner1',
  callerRole: null,
  target: null,
  roleUpdates: [],
  deletes: 0,
  unassigns: [],
};

const TENANT = {
  id: 't1',
  owner_user_id: 'owner1',
  phone_number_id: null,
  waba_id: null,
  access_token_enc: null,
};

function chain(resolve: (filters: Record<string, unknown>) => unknown) {
  const filters: Record<string, unknown> = {};
  const query: Record<string, unknown> = {};
  query.select = () => query;
  query.eq = (column: string, value: unknown) => {
    filters[column] = value;
    return query;
  };
  query.maybeSingle = async () => resolve(filters);
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
        return chain(() => ({ data: null, error: null }));
      }
      if (table === 'crm_tenants') {
        return chain(() => ({ data: TENANT, error: null }));
      }
      if (table === 'conversations') {
        const q = chain(() => ({ error: null }));
        q.update = (values: Record<string, unknown>) => {
          state.unassigns.push(values);
          return q;
        };
        return q;
      }
      // crm_tenant_members: the caller's role, or the target member row.
      const q = chain((filters) => {
        if (
          filters.user_id === state.userId &&
          filters.user_id !== state.target?.user_id
        ) {
          return {
            data: state.callerRole ? { role: state.callerRole } : null,
            error: null,
          };
        }
        if (filters.user_id === state.target?.user_id) {
          return { data: state.target, error: null };
        }
        return { data: null, error: null };
      });
      q.update = (values: Record<string, unknown>) => {
        state.roleUpdates.push(values);
        return q;
      };
      q.delete = () => {
        state.deletes += 1;
        return q;
      };
      return q;
    },
  }),
}));

import { DELETE, PATCH } from './route';

const ctx = (userId: string) => ({
  params: Promise.resolve({ slug: 'amstago', userId }),
});

const patch = (userId: string, body: unknown) =>
  PATCH(
    new NextRequest('http://localhost/x', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    ctx(userId)
  );

const remove = (userId: string) =>
  DELETE(
    new NextRequest('http://localhost/x', { method: 'DELETE' }),
    ctx(userId)
  );

beforeEach(() => {
  state.userId = 'owner1';
  state.callerRole = null;
  state.target = { user_id: 'agent1', role: 'agent' };
  state.roleUpdates = [];
  state.deletes = 0;
  state.unassigns = [];
});

describe('PATCH /api/tenants/[slug]/members/[userId]', () => {
  it('lets the owner change a role', async () => {
    const res = await patch('agent1', { role: 'admin' });
    expect(res.status).toBe(200);
    expect(state.roleUpdates).toEqual([{ role: 'admin' }]);
  });

  it('rejects an invalid role and an unknown member', async () => {
    expect((await patch('agent1', { role: 'owner' })).status).toBe(400);
    state.target = null;
    expect((await patch('ghost', { role: 'agent' })).status).toBe(404);
  });

  it('stops a team admin promoting anyone to admin', async () => {
    state.userId = 'admin1';
    state.callerRole = 'admin';
    expect((await patch('agent1', { role: 'admin' })).status).toBe(403);
    expect(state.roleUpdates).toEqual([]);
  });

  it('stops a team admin demoting another admin', async () => {
    state.userId = 'admin1';
    state.callerRole = 'admin';
    state.target = { user_id: 'admin2', role: 'admin' };
    expect((await patch('admin2', { role: 'agent' })).status).toBe(403);
  });
});

describe('DELETE /api/tenants/[slug]/members/[userId]', () => {
  it('removes a member and unassigns their conversations', async () => {
    const res = await remove('agent1');
    expect(res.status).toBe(200);
    expect(state.deletes).toBe(1);
    expect(state.unassigns).toEqual([{ assigned_agent_id: null }]);
  });

  it('lets a team admin remove an agent but not an admin', async () => {
    state.userId = 'admin1';
    state.callerRole = 'admin';
    expect((await remove('agent1')).status).toBe(200);
    state.target = { user_id: 'admin2', role: 'admin' };
    expect((await remove('admin2')).status).toBe(403);
  });

  it('rejects a plain agent', async () => {
    state.userId = 'agent9';
    state.callerRole = 'agent';
    expect((await remove('agent1')).status).toBe(403);
    expect(state.deletes).toBe(0);
  });
});
