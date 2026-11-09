import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface TenantRow {
  id: string;
  owner_user_id: string | null;
  waba_id: string | null;
  phone_number_id: string | null;
  access_token_enc: string | null;
  verify_token: string | null;
}

interface FakeState {
  userId: string | null;
  tenant: TenantRow | null;
  isAdmin: boolean;
  updates: Array<Record<string, unknown>>;
}

const state: FakeState = {
  userId: 'u1',
  tenant: null,
  isAdmin: false,
  updates: [],
};

function fakeQuery(table: string) {
  const query = {
    select: () => query,
    eq: () => query,
    update: (values: Record<string, unknown>) => {
      state.updates.push(values);
      return query;
    },
    maybeSingle: async () => {
      if (table === 'crm_platform_admins') {
        return { data: state.isAdmin ? { user_id: 'u1' } : null, error: null };
      }
      return { data: state.tenant, error: null };
    },
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
  decrypt: (value: string) => value.replace(/^enc\((.*)\)$/, '$1'),
}));

const DESIRED = 'https://crm.example.com/api/whatsapp/webhook';
const OLD = 'https://old.example.com/webhooks/whatsapp/+910000000000';

interface MetaScenario {
  phoneOverride: string | null;
  wabaOverride: string | null;
  failRead: boolean;
}

let meta: MetaScenario;
let posts: Array<{ url: string; body: Record<string, unknown> }>;

function installFetchMock() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status });

      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        posts.push({ url, body });
        // Apply the change so the follow-up read reflects it.
        if (url.includes('/subscribed_apps')) {
          meta.wabaOverride = body.override_callback_uri;
        } else if (body.webhook_configuration) {
          meta.phoneOverride = body.webhook_configuration.override_callback_uri;
        }
        return json({ success: true });
      }
      if (meta.failRead) {
        return json({ error: { message: '(#100) not allowed' } }, 400);
      }
      if (url.includes('/subscribed_apps')) {
        return json({
          data: [
            {
              whatsapp_business_api_data: { id: 'app123' },
              override_callback_uri: meta.wabaOverride,
            },
          ],
        });
      }
      return json({
        webhook_configuration: {
          application: DESIRED,
          ...(meta.phoneOverride ? { phone_number: meta.phoneOverride } : {}),
        },
      });
    })
  );
}

async function callRoute(
  body: Record<string, unknown> | null,
  headers: Record<string, string> = {
    'x-forwarded-host': 'crm.example.com',
    'x-forwarded-proto': 'https',
  }
) {
  const { POST } = await import('./route');
  const req = new NextRequest('http://localhost/api/whatsapp/webhook-sync', {
    method: 'POST',
    headers,
    body: body === null ? 'not json' : JSON.stringify(body),
  });
  return POST(req);
}

beforeEach(() => {
  vi.stubEnv('META_APP_ID', 'app123');
  Object.assign(state, {
    userId: 'u1',
    isAdmin: false,
    updates: [],
    tenant: {
      id: 't1',
      owner_user_id: 'u1',
      waba_id: 'waba1',
      phone_number_id: 'p1',
      access_token_enc: 'enc(tok)',
      verify_token: 'vt-secret',
    },
  });
  meta = { phoneOverride: null, wabaOverride: null, failRead: false };
  posts = [];
  installFetchMock();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('POST /api/whatsapp/webhook-sync — access and input', () => {
  it('rejects a request with no session', async () => {
    state.userId = null;
    expect((await callRoute({ tenantSlug: 'a' })).status).toBe(401);
  });

  it('rejects a missing slug and an unreadable body', async () => {
    expect((await callRoute({})).status).toBe(400);
    expect((await callRoute(null)).status).toBe(400);
  });

  it('returns 404 for an unknown tenant', async () => {
    state.tenant = null;
    expect((await callRoute({ tenantSlug: 'a' })).status).toBe(404);
  });

  it("forbids another user's tenant", async () => {
    state.tenant!.owner_user_id = 'someone-else';
    const res = await callRoute({ tenantSlug: 'a' });
    expect(res.status).toBe(403);
    expect(posts).toHaveLength(0);
  });

  it('asks to save credentials first when no token is stored', async () => {
    state.tenant!.access_token_enc = null;
    expect((await callRoute({ tenantSlug: 'a' })).status).toBe(400);
  });

  it('refuses to run from a non-https origin', async () => {
    const res = await callRoute(
      { tenantSlug: 'a' },
      { host: 'localhost:3010', 'x-forwarded-proto': 'http' }
    );
    expect(res.status).toBe(400);
    expect(posts).toHaveLength(0);
  });

  it('reports a Meta read failure instead of changing anything', async () => {
    meta.failRead = true;
    const res = await callRoute({ tenantSlug: 'a' });
    expect(res.status).toBe(502);
    expect(posts).toHaveLength(0);
  });
});

describe('POST /api/whatsapp/webhook-sync — overrides', () => {
  it('changes nothing when no override exists', async () => {
    const res = await callRoute({ tenantSlug: 'a' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      webhookUrl: DESIRED,
      changed: { phone: false, waba: false },
    });
    expect(posts).toHaveLength(0);
  });

  it('leaves an override that already points at the CRM alone', async () => {
    meta.phoneOverride = DESIRED;
    meta.wabaOverride = DESIRED;
    const res = await callRoute({ tenantSlug: 'a' });
    expect((await res.json()).changed).toEqual({ phone: false, waba: false });
    expect(posts).toHaveLength(0);
  });

  it('re-points a leftover phone-number override at the CRM', async () => {
    meta.phoneOverride = OLD;
    const res = await callRoute({ tenantSlug: 'a' });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.changed).toEqual({ phone: true, waba: false });
    expect(json.before.phone).toBe(OLD);
    expect(json.after.phone).toBe(DESIRED);
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toMatch(/\/p1$/);
    expect(posts[0].body).toEqual({
      webhook_configuration: {
        override_callback_uri: DESIRED,
        verify_token: 'vt-secret',
      },
    });
  });

  it('re-points a leftover account override at the CRM', async () => {
    meta.wabaOverride = OLD;
    const res = await callRoute({ tenantSlug: 'a' });
    expect((await res.json()).changed).toEqual({ phone: false, waba: true });
    expect(posts[0].url).toMatch(/\/waba1\/subscribed_apps$/);
    expect(posts[0].body).toEqual({
      override_callback_uri: DESIRED,
      verify_token: 'vt-secret',
    });
  });

  it('fixes both levels when both point elsewhere', async () => {
    meta.phoneOverride = OLD;
    meta.wabaOverride = OLD;
    const res = await callRoute({ tenantSlug: 'a' });
    expect((await res.json()).changed).toEqual({ phone: true, waba: true });
    expect(posts).toHaveLength(2);
  });

  it('generates and stores a verify token when the tenant has none', async () => {
    state.tenant!.verify_token = null;
    meta.phoneOverride = OLD;
    const res = await callRoute({ tenantSlug: 'a' });
    expect(res.status).toBe(200);
    expect(state.updates).toHaveLength(1);
    const stored = state.updates[0].verify_token as string;
    expect(stored).toMatch(/^[0-9a-f]{32}$/);
    expect(
      (posts[0].body.webhook_configuration as { verify_token: string })
        .verify_token
    ).toBe(stored);
  });

  it('lets a platform admin sync a tenant they do not own', async () => {
    state.isAdmin = true;
    state.tenant!.owner_user_id = 'client-user';
    meta.phoneOverride = OLD;
    expect((await callRoute({ tenantSlug: 'a' })).status).toBe(200);
  });
});
