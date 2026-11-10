import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetRateLimitForTests } from '@/lib/rate-limit';

interface FakeState {
  user: { id: string; email?: string; user_metadata?: object } | null;
  existingSlug: string | null;
  insertErrors: Array<{ code?: string; message: string } | null>;
  inserted: Array<Record<string, unknown>>;
}

const state: FakeState = {
  user: null,
  existingSlug: null,
  insertErrors: [],
  inserted: [],
};

function tenantsQuery() {
  const query = {
    select: () => query,
    eq: () => query,
    order: () => query,
    limit: () => query,
    maybeSingle: async () => ({
      data: state.existingSlug ? { slug: state.existingSlug } : null,
      error: null,
    }),
    insert: async (values: Record<string, unknown>) => {
      state.inserted.push(values);
      return { error: state.insertErrors.shift() ?? null };
    },
  };
  return query;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
  }),
}));

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({ from: () => tenantsQuery() }),
}));

async function post() {
  const { POST } = await import('./route');
  return POST();
}

beforeEach(() => {
  __resetRateLimitForTests();
  Object.assign(state, {
    user: {
      id: 'u1',
      email: 'asha@example.com',
      user_metadata: { full_name: 'Asha Rao' },
    },
    existingSlug: null,
    insertErrors: [],
    inserted: [],
  });
});

describe('POST /api/tenants/self', () => {
  it('rejects a request with no session', async () => {
    state.user = null;
    expect((await post()).status).toBe(401);
    expect(state.inserted).toHaveLength(0);
  });

  it('returns the existing workspace without creating another', async () => {
    state.existingSlug = 'asha-rao-ab12cd';
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      slug: 'asha-rao-ab12cd',
      created: false,
    });
    expect(state.inserted).toHaveLength(0);
  });

  it('creates a pending workspace owned by the caller on first visit', async () => {
    const res = await post();
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.created).toBe(true);
    expect(body.slug).toMatch(/^asha-rao-[0-9a-f]{6}$/);
    expect(state.inserted[0]).toMatchObject({
      name: 'Asha Rao',
      slug: body.slug,
      plan: 'starter',
      status: 'pending',
      owner_user_id: 'u1',
    });
  });

  it('retries with a new slug when the first one collides', async () => {
    state.insertErrors = [{ code: '23505', message: 'duplicate key' }];
    const res = await post();
    expect(res.status).toBe(201);
    expect(state.inserted).toHaveLength(2);
    expect(state.inserted[0].slug).not.toBe(state.inserted[1].slug);
  });

  it('reports a failure for any other insert error without retrying', async () => {
    state.insertErrors = [{ code: '42501', message: 'permission denied' }];
    const res = await post();
    expect(res.status).toBe(500);
    expect(state.inserted).toHaveLength(1);
  });
});
