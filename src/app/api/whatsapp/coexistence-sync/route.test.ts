import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeEvent {
  tenant_id: string;
  event_type: string;
  created_at: string;
  raw_payload?: unknown;
}

interface FakeState {
  userId: string | null;
  isAdmin: boolean;
  tenant: {
    id: string;
    owner_user_id: string | null;
    phone_number_id: string | null;
    access_token_enc: string | null;
  } | null;
  events: FakeEvent[];
  insertError: string | null;
}

const state: FakeState = {
  userId: 'u1',
  isAdmin: false,
  tenant: null,
  events: [],
  insertError: null,
};

function fakeQuery(table: string) {
  const filters: Array<(row: FakeEvent) => boolean> = [];
  const query = {
    select: () => query,
    eq: (column: string, value: unknown) => {
      filters.push(
        (row) => (row as unknown as Record<string, unknown>)[column] === value
      );
      return query;
    },
    in: (column: string, values: unknown[]) => {
      filters.push((row) =>
        values.includes((row as unknown as Record<string, unknown>)[column])
      );
      return query;
    },
    insert: async (row: Record<string, unknown>) => {
      if (state.insertError) return { error: { message: state.insertError } };
      state.events.push({
        created_at: new Date().toISOString(),
        ...row,
      } as FakeEvent);
      return { error: null };
    },
    maybeSingle: async () => {
      if (table === 'crm_platform_admins') {
        return { data: state.isAdmin ? { user_id: 'u1' } : null, error: null };
      }
      return { data: state.tenant, error: null };
    },
    then: (resolve: (value: unknown) => unknown) =>
      resolve({
        data: state.events.filter((row) => filters.every((f) => f(row))),
        error: null,
      }),
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

interface MetaScenario {
  onBusinessApp: boolean;
  syncError: string | null;
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
        posts.push({ url, body: JSON.parse(String(init.body)) });
        return meta.syncError
          ? json({ error: { message: meta.syncError } }, 400)
          : json({ messaging_product: 'whatsapp', request_id: 'req-1' });
      }
      return json({
        is_on_biz_app: meta.onBusinessApp,
        platform_type: 'CLOUD_API',
      });
    })
  );
}

async function post(body: Record<string, unknown> | null) {
  const { POST } = await import('./route');
  return POST(
    new NextRequest('http://localhost/api/whatsapp/coexistence-sync', {
      method: 'POST',
      body: body === null ? 'not json' : JSON.stringify(body),
    })
  );
}

async function get(slug?: string) {
  const { GET } = await import('./route');
  const query = slug ? `?tenantSlug=${slug}` : '';
  return GET(
    new NextRequest(`http://localhost/api/whatsapp/coexistence-sync${query}`)
  );
}

// Well in the past, so requests recorded "now" always come after it.
function onboarded(createdAt = '2026-11-01T10:00:00.000Z'): FakeEvent {
  return {
    tenant_id: 't1',
    event_type: 'completed_coexistence',
    created_at: createdAt,
  };
}

beforeEach(() => {
  Object.assign(state, {
    userId: 'u1',
    isAdmin: false,
    tenant: {
      id: 't1',
      owner_user_id: 'u1',
      phone_number_id: 'p1',
      access_token_enc: 'enc(tok)',
    },
    events: [onboarded()],
    insertError: null,
  });
  meta = { onBusinessApp: true, syncError: null };
  posts = [];
  installFetchMock();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/whatsapp/coexistence-sync — access and input', () => {
  it('rejects a request with no session', async () => {
    state.userId = null;
    expect((await post({ tenantSlug: 'a', sync: 'contacts' })).status).toBe(
      401
    );
  });

  it('rejects missing or invalid input', async () => {
    expect((await post({ sync: 'contacts' })).status).toBe(400);
    expect((await post({ tenantSlug: 'a', sync: 'everything' })).status).toBe(
      400
    );
    expect((await post(null)).status).toBe(400);
  });

  it('returns 404 for an unknown tenant and 403 for someone else’s', async () => {
    state.tenant = null;
    expect((await post({ tenantSlug: 'a', sync: 'contacts' })).status).toBe(
      404
    );

    state.tenant = {
      id: 't1',
      owner_user_id: 'someone-else',
      phone_number_id: 'p1',
      access_token_enc: 'enc(tok)',
    };
    const res = await post({ tenantSlug: 'a', sync: 'contacts' });
    expect(res.status).toBe(403);
    expect(posts).toHaveLength(0);
  });

  it('asks to save credentials first when no token is stored', async () => {
    state.tenant!.access_token_enc = null;
    expect((await post({ tenantSlug: 'a', sync: 'contacts' })).status).toBe(
      400
    );
  });
});

describe('POST /api/whatsapp/coexistence-sync — the one-time rules', () => {
  it('refuses a tenant that was not connected through coexistence', async () => {
    state.events = [];
    const res = await post({ tenantSlug: 'a', sync: 'contacts' });
    expect(res.status).toBe(400);
    expect(posts).toHaveLength(0);
  });

  it('refuses history before contacts', async () => {
    const res = await post({ tenantSlug: 'a', sync: 'history' });
    expect(res.status).toBe(409);
    expect(posts).toHaveLength(0);
  });

  it('refuses to request contacts a second time', async () => {
    await post({ tenantSlug: 'a', sync: 'contacts' });
    posts = [];
    const again = await post({ tenantSlug: 'a', sync: 'contacts' });
    expect(again.status).toBe(409);
    expect(posts).toHaveLength(0);
  });

  it('refuses a number that is not on the WhatsApp Business app', async () => {
    meta.onBusinessApp = false;
    const res = await post({ tenantSlug: 'a', sync: 'contacts' });
    expect(res.status).toBe(409);
    expect(posts).toHaveLength(0);
  });
});

describe('POST /api/whatsapp/coexistence-sync — requesting the sync', () => {
  it('requests contacts from Meta and records it', async () => {
    const res = await post({ tenantSlug: 'a', sync: 'contacts' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      sync: 'contacts',
      requestId: 'req-1',
      deadline: '2026-11-02T10:00:00.000Z',
      recorded: true,
    });
    expect(posts[0].url).toMatch(/\/p1\/smb_app_data$/);
    expect(posts[0].body).toEqual({
      messaging_product: 'whatsapp',
      sync_type: 'smb_app_state_sync',
    });
    expect(state.events.at(-1)).toMatchObject({
      event_type: 'coexistence_sync_contacts',
      raw_payload: { request_id: 'req-1' },
    });
  });

  it('requests history once contacts were requested', async () => {
    await post({ tenantSlug: 'a', sync: 'contacts' });
    posts = [];
    const res = await post({ tenantSlug: 'a', sync: 'history' });
    expect(res.status).toBe(200);
    expect(posts[0].body).toMatchObject({ sync_type: 'history' });
    expect(state.events.at(-1)?.event_type).toBe('coexistence_sync_history');
  });

  it('does not record a request Meta refused, so it can be retried', async () => {
    meta.syncError = 'not allowed';
    const res = await post({ tenantSlug: 'a', sync: 'contacts' });
    expect(res.status).toBe(502);
    expect(state.events).toHaveLength(1);
  });

  it('still reports success if only the record could not be saved', async () => {
    state.insertError = 'disk full';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post({ tenantSlug: 'a', sync: 'contacts' });
    expect(res.status).toBe(200);
    expect((await res.json()).recorded).toBe(false);
  });
});

describe('GET /api/whatsapp/coexistence-sync', () => {
  it('reports the state for a coexistence tenant', async () => {
    const res = await get('a');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      coexistence: true,
      contactsRequested: false,
      historyRequested: false,
    });
  });

  it('requires a session and a slug', async () => {
    expect((await get()).status).toBe(400);
    state.userId = null;
    expect((await get('a')).status).toBe(401);
  });
});
