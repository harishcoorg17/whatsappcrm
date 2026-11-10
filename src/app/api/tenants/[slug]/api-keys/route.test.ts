import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetRateLimitForTests } from '@/lib/rate-limit';
import { hashApiKey } from '@/lib/integrations/api-key';

interface KeyRow {
  id: string;
  tenant_id: string;
  label: string;
  key_prefix: string;
  key_hash: string;
  created_by?: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

interface FakeState {
  userId: string | null;
  tenant: { id: string; owner_user_id: string | null } | null;
  isPlatformAdmin: boolean;
  keys: KeyRow[];
  nextId: number;
}

const state: FakeState = {
  userId: 'u1',
  tenant: { id: 't1', owner_user_id: 'u1' },
  isPlatformAdmin: false,
  keys: [],
  nextId: 1,
};

function tenantsQuery() {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: state.tenant, error: null }),
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

function keysQuery() {
  const filters: Array<[string, unknown]> = [];
  let activeOnly = false;
  let countOnly = false;
  const matching = () =>
    state.keys.filter(
      (key) =>
        filters.every(([column, value]) => (key as never)[column] === value) &&
        (!activeOnly || key.revoked_at === null)
    );

  let columns: string[] | null = null;
  const project = (row: KeyRow) =>
    columns
      ? Object.fromEntries(columns.map((c) => [c, (row as never)[c]]))
      : row;

  const query = {
    select: (list?: string, options?: { count?: string; head?: boolean }) => {
      countOnly = Boolean(options?.head);
      // Like the real database, only return the columns that were asked for.
      columns =
        list && list !== '*' ? list.split(',').map((c) => c.trim()) : null;
      return query;
    },
    eq: (column: string, value: unknown) => {
      filters.push([column, value]);
      return query;
    },
    is: () => {
      activeOnly = true;
      return query;
    },
    order: () => query,
    then: (resolve: (value: unknown) => void) =>
      resolve(
        countOnly
          ? { count: matching().length, error: null }
          : { data: matching().map(project), error: null }
      ),
    insert: (values: Partial<KeyRow>) => {
      const row = {
        id: `k${state.nextId++}`,
        created_at: '2026-11-10T12:00:00.000Z',
        last_used_at: null,
        revoked_at: null,
        ...values,
      } as KeyRow;
      state.keys.push(row);
      return {
        select: (list?: string) => ({
          single: async () => {
            const picked = list
              ? Object.fromEntries(
                  list
                    .split(',')
                    .map((c) => [c.trim(), (row as never)[c.trim()]])
                )
              : row;
            return { data: picked, error: null };
          },
        }),
      };
    },
    update: (values: Partial<KeyRow>) => {
      const updateFilters: Array<[string, unknown]> = [];
      let onlyActive = false;
      const chain = {
        eq: (column: string, value: unknown) => {
          updateFilters.push([column, value]);
          return chain;
        },
        is: () => {
          onlyActive = true;
          return chain;
        },
        select: () => chain,
        maybeSingle: async () => {
          const target = state.keys.find(
            (key) =>
              updateFilters.every(
                ([column, value]) => (key as never)[column] === value
              ) &&
              (!onlyActive || key.revoked_at === null)
          );
          if (!target) return { data: null, error: null };
          Object.assign(target, values);
          return { data: { id: target.id }, error: null };
        },
      };
      return chain;
    },
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
    from: (table: string) => {
      if (table === 'crm_platform_admins') return adminsQuery();
      if (table === 'crm_api_keys') return keysQuery();
      return tenantsQuery();
    },
  }),
}));

const PARAMS = { params: Promise.resolve({ slug: 'amstago-tours' }) };

async function call(method: string, body?: unknown, search = '') {
  const route = await import('./route');
  const request = new NextRequest(
    `http://localhost/api/tenants/amstago-tours/api-keys${search}`,
    {
      method,
      // A GET request cannot carry a body.
      body:
        method === 'GET' || body === undefined
          ? undefined
          : JSON.stringify(body),
    }
  );
  return (
    route as never as Record<
      string,
      (r: NextRequest, c: typeof PARAMS) => Promise<Response>
    >
  )[method](request, PARAMS);
}

beforeEach(() => {
  __resetRateLimitForTests();
  Object.assign(state, {
    userId: 'u1',
    tenant: { id: 't1', owner_user_id: 'u1' },
    isPlatformAdmin: false,
    keys: [],
    nextId: 1,
  });
});

describe.each(['GET', 'POST', 'DELETE'])(
  '%s /api-keys access control',
  (method) => {
    it('rejects a request with no session', async () => {
      state.userId = null;
      expect((await call(method, {})).status).toBe(401);
    });

    it('returns 404 for an unknown tenant', async () => {
      state.tenant = null;
      expect((await call(method, {})).status).toBe(404);
    });

    it('refuses someone who neither owns the tenant nor is a platform admin', async () => {
      state.tenant = { id: 't1', owner_user_id: 'someone-else' };
      expect((await call(method, {})).status).toBe(403);
    });
  }
);

describe('POST /api-keys', () => {
  it('creates a key, shows the plaintext once, and stores only its hash', async () => {
    const res = await call('POST', { label: 'Amstago backend' });
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(body.key).toMatch(/^amst_live_[A-Za-z0-9_-]{43}$/);
    expect(body).toMatchObject({ label: 'Amstago backend' });

    expect(state.keys).toHaveLength(1);
    expect(state.keys[0].key_hash).toBe(hashApiKey(body.key));
    expect(JSON.stringify(state.keys[0])).not.toContain(body.key);
    expect(state.keys[0]).toMatchObject({
      tenant_id: 't1',
      label: 'Amstago backend',
      created_by: 'u1',
      key_prefix: body.key.slice(0, 14),
    });
  });

  it('defaults the label and trims an overlong one', async () => {
    await call('POST', {});
    expect(state.keys[0].label).toBe('Backend');
    await call('POST', { label: 'x'.repeat(200) });
    expect(state.keys[1].label.length).toBeLessThanOrEqual(60);
  });

  it('lets a platform admin create a key for another owner’s tenant', async () => {
    state.tenant = { id: 't1', owner_user_id: 'someone-else' };
    state.isPlatformAdmin = true;
    expect((await call('POST', {})).status).toBe(201);
  });

  it('refuses a new key once the tenant has too many active ones', async () => {
    // Seeded directly: creating ten through the route would trip its own
    // rate limit before the cap is reached.
    state.keys = Array.from({ length: 10 }, (_, i) => ({
      id: `seed-${i}`,
      tenant_id: 't1',
      label: 'x',
      key_prefix: 'amst_live_abcd',
      key_hash: `hash-${i}`,
      created_at: '2026-11-10T12:00:00.000Z',
      last_used_at: null,
      revoked_at: null,
    }));
    const res = await call('POST', {});
    expect(res.status).toBe(409);
    expect(state.keys).toHaveLength(10);
  });

  it('does not count revoked keys against the cap', async () => {
    state.keys = Array.from({ length: 10 }, (_, i) => ({
      id: `seed-${i}`,
      tenant_id: 't1',
      label: 'x',
      key_prefix: 'amst_live_abcd',
      key_hash: `hash-${i}`,
      created_at: '2026-11-10T12:00:00.000Z',
      last_used_at: null,
      revoked_at: i === 0 ? '2026-11-10T13:00:00.000Z' : null,
    }));
    expect((await call('POST', {})).status).toBe(201);
  });
});

describe('GET /api-keys', () => {
  it('lists keys without their hash or secret', async () => {
    await call('POST', { label: 'A' });
    const res = await call('GET');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keys).toHaveLength(1);
    expect(Object.keys(body.keys[0]).sort()).toEqual(
      [
        'created_at',
        'id',
        'key_prefix',
        'label',
        'last_used_at',
        'revoked_at',
      ].sort()
    );
  });
});

describe('DELETE /api-keys', () => {
  it('revokes a key of this tenant', async () => {
    await call('POST', {});
    const id = state.keys[0].id;
    const res = await call('DELETE', undefined, `?id=${id}`);
    expect(res.status).toBe(200);
    expect(state.keys[0].revoked_at).not.toBeNull();
  });

  it('needs an id', async () => {
    expect((await call('DELETE')).status).toBe(400);
  });

  it('cannot revoke a key that belongs to another tenant', async () => {
    state.keys.push({
      id: 'other-key',
      tenant_id: 'other-tenant',
      label: 'x',
      key_prefix: 'amst_live_abcd',
      key_hash: 'h',
      created_at: '2026-11-10T12:00:00.000Z',
      last_used_at: null,
      revoked_at: null,
    });
    const res = await call('DELETE', undefined, '?id=other-key');
    expect(res.status).toBe(404);
    expect(state.keys[0].revoked_at).toBeNull();
  });

  it('reports a key that is already revoked as not found', async () => {
    await call('POST', {});
    const id = state.keys[0].id;
    await call('DELETE', undefined, `?id=${id}`);
    expect((await call('DELETE', undefined, `?id=${id}`)).status).toBe(404);
  });
});
