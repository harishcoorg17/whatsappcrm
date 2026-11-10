import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetRateLimitForTests } from '@/lib/rate-limit';

vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: (value: string) => `enc(${value})`,
}));

interface FakeState {
  userId: string | null;
  tenant: {
    id: string;
    owner_user_id: string | null;
    data_api_config?: Record<string, unknown> | null;
  } | null;
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
      has_api_key: false,
    });
    expect(state.updates).toEqual([
      { data_api_url: 'https://api.example.com/api' },
    ]);
  });

  it('clears the address when the url is empty', async () => {
    const res = await put({ url: '   ' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data_api_url: null,
      has_api_key: false,
    });
    expect(state.updates).toEqual([{ data_api_url: null }]);
  });

  it('reports a failed save', async () => {
    state.updateError = 'boom';
    const res = await put({ url: 'https://api.example.com' });
    expect(res.status).toBe(500);
  });
});

describe('PUT /api/tenants/[slug]/data-api — integration key', () => {
  const KEY = 'integration-secret-123';

  it('stores the key encrypted next to the address, and never echoes it', async () => {
    const res = await put({ url: 'https://api.example.com/api', api_key: KEY });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      data_api_url: 'https://api.example.com/api',
      has_api_key: true,
    });
    expect(JSON.stringify(body)).not.toContain(KEY);

    const saved = state.updates[0].data_api_config as Record<string, unknown>;
    expect(saved.api_key_enc).toBe(`enc(${KEY})`);
    expect(saved.api_key_set_at).toEqual(expect.any(String));
    expect(JSON.stringify(state.updates)).not.toContain(`"${KEY}"`);
  });

  it('keeps other settings in data_api_config when it adds the key', async () => {
    state.tenant = {
      id: 't1',
      owner_user_id: 'u1',
      data_api_config: { timeout_ms: 3000 },
    };
    await put({ url: 'https://api.example.com/api', api_key: KEY });
    expect(state.updates[0].data_api_config).toMatchObject({
      timeout_ms: 3000,
      api_key_enc: `enc(${KEY})`,
    });
  });

  it('leaves an existing key alone when only the address changes', async () => {
    state.tenant = {
      id: 't1',
      owner_user_id: 'u1',
      data_api_config: { api_key_enc: 'enc(old)' },
    };
    const res = await put({ url: 'https://api.example.com/v2' });
    expect(await res.json()).toEqual({
      data_api_url: 'https://api.example.com/v2',
      has_api_key: true,
    });
    expect(state.updates[0]).not.toHaveProperty('data_api_config');
  });

  it('removes the key when asked to', async () => {
    state.tenant = {
      id: 't1',
      owner_user_id: 'u1',
      data_api_config: {
        api_key_enc: 'enc(old)',
        api_key_set_at: 'x',
        keep: 1,
      },
    };
    const res = await put({
      url: 'https://api.example.com/api',
      clear_api_key: true,
    });
    expect((await res.json()).has_api_key).toBe(false);
    expect(state.updates[0].data_api_config).toEqual({ keep: 1 });
  });

  it('removes the key when the address is cleared', async () => {
    state.tenant = {
      id: 't1',
      owner_user_id: 'u1',
      data_api_config: { api_key_enc: 'enc(old)' },
    };
    const res = await put({ url: '' });
    expect(await res.json()).toEqual({
      data_api_url: null,
      has_api_key: false,
    });
    expect(state.updates[0].data_api_config).toEqual({});
  });

  it.each([
    ['too short', 'abc'],
    ['has a space', 'has a space in it 123'],
    ['has a newline', 'line1\nline2-line2'],
    ['too long', 'k'.repeat(300)],
  ])('rejects a key that is %s', async (_label, key) => {
    const res = await put({ url: 'https://api.example.com/api', api_key: key });
    expect(res.status).toBe(400);
    expect(state.updates).toHaveLength(0);
  });

  it('refuses a key with no address to send it to', async () => {
    const res = await put({ url: '', api_key: KEY });
    expect(res.status).toBe(400);
    expect(state.updates).toHaveLength(0);
  });
});
