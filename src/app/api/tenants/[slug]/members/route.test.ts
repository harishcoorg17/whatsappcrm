import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetRateLimitForTests } from '@/lib/rate-limit';

interface FakeState {
  userId: string | null;
  isPlatformAdmin: boolean;
  /** The caller's own team role, if they are a member rather than the owner. */
  callerRole: 'admin' | 'agent' | null;
  tenant: {
    id: string;
    owner_user_id: string | null;
    phone_number_id: string | null;
    waba_id: string | null;
    access_token_enc: string | null;
  };
  members: Array<{ user_id: string; role: string; created_at: string }>;
  profiles: Array<{ user_id: string; full_name: string | null; email: string }>;
  inviteFails: boolean;
  invited: string[];
  upserts: Array<Record<string, unknown>>;
}

const state: FakeState = {
  userId: 'owner1',
  isPlatformAdmin: false,
  callerRole: null,
  tenant: {
    id: 't1',
    owner_user_id: 'owner1',
    phone_number_id: null,
    waba_id: null,
    access_token_enc: null,
  },
  members: [],
  profiles: [],
  inviteFails: false,
  invited: [],
  upserts: [],
};

function chain(resolve: (filters: Record<string, unknown>) => unknown) {
  const filters: Record<string, unknown> = {};
  const query: Record<string, unknown> = {};
  query.select = (_c?: string, opts?: { head?: boolean }) => {
    if (opts?.head) filters.__count = true;
    return query;
  };
  query.eq = (column: string, value: unknown) => {
    filters[column] = value;
    return query;
  };
  query.in = (column: string, values: unknown) => {
    filters[column] = values;
    return query;
  };
  query.ilike = (column: string, value: unknown) => {
    filters[`${column}~`] = value;
    return query;
  };
  query.order = () => query;
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
    auth: {
      admin: {
        inviteUserByEmail: async (email: string) => {
          if (state.inviteFails) {
            return { data: { user: null }, error: { message: 'smtp down' } };
          }
          state.invited.push(email);
          return { data: { user: { id: 'invited-user' } }, error: null };
        },
      },
    },
    from: (table: string) => {
      if (table === 'crm_platform_admins') {
        return chain(() => ({
          data: state.isPlatformAdmin ? { user_id: state.userId } : null,
          error: null,
        }));
      }
      if (table === 'crm_tenants') {
        return chain(() => ({ data: state.tenant, error: null }));
      }
      if (table === 'profiles') {
        return chain((filters) => {
          if ('email~' in filters) {
            const hit = state.profiles.find(
              (p) => p.email === String(filters['email~']).replace(/\\/g, '')
            );
            return { data: hit ?? null, error: null };
          }
          const ids = (filters.user_id as string[]) ?? [];
          return {
            data: state.profiles.filter((p) => ids.includes(p.user_id)),
            error: null,
          };
        });
      }
      // crm_tenant_members
      const q = chain((filters) => {
        if (filters.__count)
          return { count: state.members.length, error: null };
        if ('user_id' in filters) {
          // The caller's own team role (team-admin authorization).
          return {
            data: state.callerRole ? { role: state.callerRole } : null,
            error: null,
          };
        }
        return { data: state.members, error: null };
      });
      q.upsert = async (values: Record<string, unknown>) => {
        state.upserts.push(values);
        return { error: null };
      };
      return q;
    },
  }),
}));

import { GET, POST } from './route';

const PARAMS = { params: Promise.resolve({ slug: 'amstago' }) };

function post(body: unknown) {
  return POST(
    new NextRequest('http://localhost/api/tenants/amstago/members', {
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
  state.callerRole = null;
  state.tenant = { ...state.tenant, owner_user_id: 'owner1' };
  state.members = [];
  state.profiles = [
    { user_id: 'owner1', full_name: 'Owner One', email: 'owner@amstago.com' },
    { user_id: 'agent1', full_name: 'Asha Agent', email: 'asha@amstago.com' },
  ];
  state.inviteFails = false;
  state.invited = [];
  state.upserts = [];
});

describe('GET /api/tenants/[slug]/members', () => {
  it('lists the owner first, then members, with names', async () => {
    state.members = [
      { user_id: 'agent1', role: 'agent', created_at: '2026-01-01' },
    ];
    const res = await GET(new NextRequest('http://localhost/x'), PARAMS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      members: Array<Record<string, unknown>>;
    };
    expect(body.members[0]).toMatchObject({
      user_id: 'owner1',
      role: 'owner',
      full_name: 'Owner One',
    });
    expect(body.members[1]).toMatchObject({
      user_id: 'agent1',
      role: 'agent',
      email: 'asha@amstago.com',
    });
  });

  it('rejects a stranger and a plain agent', async () => {
    state.userId = 'stranger';
    expect(
      (await GET(new NextRequest('http://localhost/x'), PARAMS)).status
    ).toBe(403);
    state.callerRole = 'agent';
    expect(
      (await GET(new NextRequest('http://localhost/x'), PARAMS)).status
    ).toBe(403);
  });

  it('lets a team admin see the team', async () => {
    state.userId = 'admin1';
    state.callerRole = 'admin';
    expect(
      (await GET(new NextRequest('http://localhost/x'), PARAMS)).status
    ).toBe(200);
  });
});

describe('POST /api/tenants/[slug]/members', () => {
  it('rejects unauthenticated requests', async () => {
    state.userId = null;
    expect((await post({ email: 'asha@amstago.com' })).status).toBe(401);
  });

  it('rejects an invalid email or role', async () => {
    expect((await post({ email: 'not-an-email' })).status).toBe(400);
    expect(
      (await post({ email: 'asha@amstago.com', role: 'god' })).status
    ).toBe(400);
    expect(state.upserts).toEqual([]);
  });

  it('adds an existing account as an agent without sending an invite', async () => {
    const res = await post({ email: 'Asha@Amstago.com' });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      invited: false,
      member: { role: 'agent', user_id: 'agent1' },
    });
    expect(state.invited).toEqual([]);
    expect(state.upserts[0]).toMatchObject({
      tenant_id: 't1',
      user_id: 'agent1',
      role: 'agent',
      invited_by: 'owner1',
    });
  });

  it('emails an invite when the person has no account yet', async () => {
    const res = await post({ email: 'new@amstago.com', role: 'agent' });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ invited: true });
    expect(state.invited).toEqual(['new@amstago.com']);
    expect(state.upserts[0]).toMatchObject({ user_id: 'invited-user' });
  });

  it('reports a failed invite without adding anyone', async () => {
    state.inviteFails = true;
    const res = await post({ email: 'new@amstago.com' });
    expect(res.status).toBe(502);
    expect(state.upserts).toEqual([]);
  });

  it('refuses to add the owner as a member', async () => {
    const res = await post({ email: 'owner@amstago.com' });
    expect(res.status).toBe(400);
    expect(state.upserts).toEqual([]);
  });

  it('only lets the owner grant the admin role', async () => {
    state.userId = 'admin1';
    state.callerRole = 'admin';
    expect(
      (await post({ email: 'asha@amstago.com', role: 'admin' })).status
    ).toBe(403);
    expect(
      (await post({ email: 'asha@amstago.com', role: 'agent' })).status
    ).toBe(201);
  });

  it('lets the owner make an admin', async () => {
    const res = await post({ email: 'asha@amstago.com', role: 'admin' });
    expect(res.status).toBe(201);
    expect(state.upserts[0]).toMatchObject({ role: 'admin' });
  });

  it('enforces the team size limit', async () => {
    state.members = Array.from({ length: 50 }, (_, i) => ({
      user_id: `u${i}`,
      role: 'agent',
      created_at: '2026-01-01',
    }));
    expect((await post({ email: 'asha@amstago.com' })).status).toBe(400);
  });
});
