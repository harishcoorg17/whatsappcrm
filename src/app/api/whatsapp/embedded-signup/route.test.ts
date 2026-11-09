import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeState {
  userId: string | null;
  tenant: { id: string; owner_user_id: string | null } | null;
  isAdmin: boolean;
  phoneUsedElsewhere: boolean;
  updates: Array<{ table: string; values: Record<string, unknown> }>;
  inserts: Array<{ table: string; values: Record<string, unknown> }>;
}

const state: FakeState = {
  userId: 'u1',
  tenant: { id: 't1', owner_user_id: 'u1' },
  isAdmin: false,
  phoneUsedElsewhere: false,
  updates: [],
  inserts: [],
};

function fakeQuery(table: string) {
  const filters: Record<string, unknown> = {};
  const query = {
    select: () => query,
    eq: (column: string, value: unknown) => {
      filters[column] = value;
      return query;
    },
    neq: () => query,
    update: (values: Record<string, unknown>) => {
      state.updates.push({ table, values });
      return query;
    },
    insert: async (values: Record<string, unknown>) => {
      state.inserts.push({ table, values });
      return { error: null };
    },
    maybeSingle: async () => {
      if (table === 'crm_platform_admins') {
        return { data: state.isAdmin ? { user_id: 'u1' } : null, error: null };
      }
      if ('phone_number_id' in filters) {
        return {
          data: state.phoneUsedElsewhere ? { id: 'other' } : null,
          error: null,
        };
      }
      return { data: state.tenant, error: null };
    },
    // Awaiting an update chain resolves like a Supabase write.
    then: (resolve: (value: { error: null }) => void) =>
      resolve({ error: null }),
  };
  return query;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => fakeQuery(table) }),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({
        data: { user: state.userId ? { id: state.userId } : null },
      }),
    },
  }),
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: async (plain: string) => `enc(${plain})`,
}));

interface MetaScenario {
  grantedWabaIds: string[];
  tokenAppId: string;
  phoneIds: string[];
  subscribeOk: boolean;
}

let meta: MetaScenario;
let fetchCalls: string[];

function installFetchMock() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push(`${init?.method ?? 'GET'} ${url}`);
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status });

      if (url.includes('/oauth/access_token')) {
        return json({ access_token: 'tok' });
      }
      if (url.includes('/debug_token')) {
        return json({
          data: {
            is_valid: true,
            app_id: meta.tokenAppId,
            granular_scopes: [
              {
                scope: 'whatsapp_business_management',
                target_ids: meta.grantedWabaIds,
              },
            ],
          },
        });
      }
      if (url.includes('/msg-acct/phone_numbers')) {
        // What Meta returns when the id is not a WhatsApp Business Account.
        return json(
          {
            error: {
              message:
                '(#100) Tried accessing nonexisting field (phone_numbers)',
            },
          },
          400
        );
      }
      if (url.includes('/phone_numbers')) {
        return json({ data: meta.phoneIds.map((id) => ({ id })) });
      }
      if (url.includes('/subscribed_apps')) {
        return meta.subscribeOk
          ? json({ success: true })
          : json({ error: { message: 'not allowed' } }, 400);
      }
      return json({ error: { message: `unexpected ${url}` } }, 500);
    })
  );
}

async function callRoute(body: Record<string, unknown> | null) {
  const { POST } = await import('./route');
  const req = new NextRequest('http://localhost/api/whatsapp/embedded-signup', {
    method: 'POST',
    body: body === null ? 'not json' : JSON.stringify(body),
  });
  return POST(req);
}

const CODE_BODY = {
  code: 'code-1',
  tenantSlug: 'amstago',
  wabaId: 'w1',
  phoneNumberId: 'p1',
  coexistence: true,
};

beforeEach(() => {
  vi.stubEnv('META_APP_ID', 'app123');
  vi.stubEnv('META_APP_SECRET', 'secret');
  Object.assign(state, {
    userId: 'u1',
    tenant: { id: 't1', owner_user_id: 'u1' },
    isAdmin: false,
    phoneUsedElsewhere: false,
    updates: [],
    inserts: [],
  });
  meta = {
    grantedWabaIds: ['w1'],
    tokenAppId: 'app123',
    phoneIds: ['p1'],
    subscribeOk: true,
  };
  fetchCalls = [];
  installFetchMock();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('POST /api/whatsapp/embedded-signup — authorization', () => {
  it('rejects a request with no session', async () => {
    state.userId = null;
    const res = await callRoute(CODE_BODY);
    expect(res.status).toBe(401);
    expect(state.updates).toHaveLength(0);
  });

  it('rejects a body without a tenant slug', async () => {
    const res = await callRoute({ code: 'c' });
    expect(res.status).toBe(400);
  });

  it('rejects an unreadable body', async () => {
    const res = await callRoute(null);
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown tenant', async () => {
    state.tenant = null;
    const res = await callRoute(CODE_BODY);
    expect(res.status).toBe(404);
  });

  it("forbids connecting another user's tenant", async () => {
    state.tenant = { id: 't1', owner_user_id: 'someone-else' };
    const res = await callRoute(CODE_BODY);
    expect(res.status).toBe(403);
    expect(state.updates).toHaveLength(0);
    expect(fetchCalls).toHaveLength(0);
  });

  it('forbids a non-admin from claiming an unowned tenant', async () => {
    state.tenant = { id: 't1', owner_user_id: null };
    const res = await callRoute(CODE_BODY);
    expect(res.status).toBe(403);
    expect(state.updates).toHaveLength(0);
  });

  it('forbids a raw token from anyone who is not a platform admin', async () => {
    const res = await callRoute({
      tenantSlug: 'amstago',
      wabaId: 'w1',
      phoneNumberId: 'p1',
      accessToken: 'raw',
    });
    expect(res.status).toBe(403);
    expect(state.updates).toHaveLength(0);
  });
});

describe('POST /api/whatsapp/embedded-signup — Meta verification', () => {
  it('rejects a WABA id Meta did not grant to the token', async () => {
    meta.grantedWabaIds = ['w-mine'];
    const res = await callRoute({ ...CODE_BODY, wabaId: 'w-victim' });
    expect(res.status).toBe(400);
    expect(state.updates).toHaveLength(0);
  });

  it('rejects a token that was issued to a different app', async () => {
    meta.tokenAppId = 'another-app';
    const res = await callRoute(CODE_BODY);
    expect(res.status).toBe(400);
    expect(state.updates).toHaveLength(0);
  });

  it('rejects a phone number that is not on the granted WABA', async () => {
    meta.phoneIds = ['p-other'];
    const res = await callRoute(CODE_BODY);
    expect(res.status).toBe(400);
    expect(state.updates).toHaveLength(0);
  });

  it('refuses a phone number already connected to another tenant', async () => {
    state.phoneUsedElsewhere = true;
    const res = await callRoute(CODE_BODY);
    expect(res.status).toBe(409);
    expect(state.updates).toHaveLength(0);
  });

  it('does not activate the tenant when the webhook subscription fails', async () => {
    meta.subscribeOk = false;
    const res = await callRoute(CODE_BODY);
    expect(res.status).toBe(502);
    expect(state.updates).toHaveLength(0);
  });
});

describe('POST /api/whatsapp/embedded-signup — success', () => {
  it('connects the owner, encrypts the token and subscribes the app', async () => {
    const res = await callRoute(CODE_BODY);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      wabaId: 'w1',
      phoneNumberId: 'p1',
      coexistence: true,
    });

    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].values).toMatchObject({
      waba_id: 'w1',
      phone_number_id: 'p1',
      status: 'active',
      owner_user_id: 'u1',
    });
    expect(state.updates[0].values.access_token_enc).toMatch(/^enc\(/);
    expect(state.updates[0].values.access_token_enc).not.toBe('tok');

    expect(
      fetchCalls.some(
        (c) => c.startsWith('POST') && c.includes('/w1/subscribed_apps')
      )
    ).toBe(true);
    expect(state.inserts[0].values).toMatchObject({
      tenant_id: 't1',
      event_type: 'completed_coexistence',
    });
  });

  it('discovers the only granted WABA and phone number when the browser sent none', async () => {
    const res = await callRoute({ code: 'c', tenantSlug: 'amstago' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      wabaId: 'w1',
      phoneNumberId: 'p1',
    });
  });

  it('lets a platform admin claim an unowned tenant', async () => {
    state.isAdmin = true;
    state.tenant = { id: 't1', owner_user_id: null };
    const res = await callRoute(CODE_BODY);
    expect(res.status).toBe(200);
    expect(state.updates[0].values.owner_user_id).toBe('u1');
  });

  it("does not replace an existing owner when an admin connects someone's tenant", async () => {
    state.isAdmin = true;
    state.tenant = { id: 't1', owner_user_id: 'client-user' };
    const res = await callRoute(CODE_BODY);
    expect(res.status).toBe(200);
    expect(state.updates[0].values.owner_user_id).toBe('client-user');
  });

  it('accepts a raw System User token from a platform admin', async () => {
    state.isAdmin = true;
    const res = await callRoute({
      tenantSlug: 'amstago',
      wabaId: 'w1',
      phoneNumberId: 'p1',
      accessToken: 'raw-token',
    });
    expect(res.status).toBe(200);
    expect(state.updates[0].values.access_token_enc).toBe('enc(raw-token)');
  });

  describe('raw token with a wrong or missing account id', () => {
    const rawBody = {
      tenantSlug: 'amstago',
      phoneNumberId: 'p1',
      accessToken: 'raw-token',
    };

    beforeEach(() => {
      state.isAdmin = true;
    });

    it('finds the real account when the entered id is not a WhatsApp Business Account', async () => {
      const res = await callRoute({ ...rawBody, wabaId: 'msg-acct' });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        wabaId: 'w1',
        phoneNumberId: 'p1',
      });
      expect(
        fetchCalls.some(
          (c) => c.startsWith('POST') && c.includes('/w1/subscribed_apps')
        )
      ).toBe(true);
      expect(state.updates[0].values.waba_id).toBe('w1');
    });

    it('works with no account id at all when the token reaches the account', async () => {
      const res = await callRoute(rawBody);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ wabaId: 'w1' });
    });

    it('refuses when no reachable account holds the number', async () => {
      meta.phoneIds = ['p-other'];
      const res = await callRoute({ ...rawBody, wabaId: 'msg-acct' });
      expect(res.status).toBe(400);
      expect(state.updates).toHaveLength(0);
    });

    it('refuses a raw token that was issued to a different app', async () => {
      meta.tokenAppId = 'another-app';
      const res = await callRoute({ ...rawBody, wabaId: 'w1' });
      expect(res.status).toBe(400);
      expect(state.updates).toHaveLength(0);
    });

    it('still requires the phone number id', async () => {
      const res = await callRoute({
        tenantSlug: 'amstago',
        accessToken: 'raw-token',
      });
      expect(res.status).toBe(400);
    });
  });
});
