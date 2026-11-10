import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Credentials {
  phoneNumberId: string;
  accessToken: string;
  wabaId: string | null;
  source: 'tenant' | 'legacy';
}

interface FakeState {
  userId: string | null;
  credentials: Credentials | null;
  inserted: Array<Record<string, unknown>>;
}

const state: FakeState = { userId: 'u1', credentials: null, inserted: [] };

function templatesQuery() {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: null, error: null }),
    insert: async (row: Record<string, unknown>) => {
      state.inserted.push(row);
      return { error: null };
    },
    update: () => query,
  };
  return query;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: state.userId ? { id: state.userId } : null },
        error: null,
      }),
    },
    from: () => templatesQuery(),
  }),
}));

const loadCredentials = vi.fn(async () => state.credentials);
vi.mock('@/lib/whatsapp/credentials', () => ({
  loadWhatsAppCredentials: (...args: unknown[]) =>
    (loadCredentials as (...a: unknown[]) => unknown)(...args),
}));

const fetchMock = vi.fn();

async function post() {
  const { POST } = await import('./route');
  return POST();
}

function metaResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  loadCredentials.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  Object.assign(state, { userId: 'u1', credentials: null, inserted: [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/whatsapp/templates/sync', () => {
  it('rejects a request with no session', async () => {
    state.userId = null;
    expect((await post()).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks the user to connect WhatsApp when nothing is connected', async () => {
    const res = await post();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not configured/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks to reconnect when the connection has no WABA id', async () => {
    state.credentials = {
      phoneNumberId: 'pn1',
      accessToken: 'tok',
      wabaId: null,
      source: 'tenant',
    };
    const res = await post();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/WABA/);
  });

  it('syncs using a number connected through Tenants', async () => {
    state.credentials = {
      phoneNumberId: 'pn1',
      accessToken: 'tenant-token',
      wabaId: 'waba-123',
      source: 'tenant',
    };
    fetchMock.mockResolvedValue(
      metaResponse({
        data: [
          {
            id: 'meta-1',
            name: 'order_update',
            language: 'en_US',
            status: 'APPROVED',
            category: 'UTILITY',
            components: [{ type: 'BODY', text: 'Your order shipped' }],
          },
        ],
      })
    );

    const res = await post();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, total: 1, inserted: 1 });
    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toContain('/waba-123/message_templates');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer tenant-token'
    );
    expect(state.inserted[0]).toMatchObject({
      user_id: 'u1',
      name: 'order_update',
      meta_template_id: 'meta-1',
    });
    expect(loadCredentials).toHaveBeenCalledTimes(1);
  });

  it("reports Meta's error message when the request fails", async () => {
    state.credentials = {
      phoneNumberId: 'pn1',
      accessToken: 'tenant-token',
      wabaId: 'waba-123',
      source: 'tenant',
    };
    fetchMock.mockResolvedValue(
      metaResponse({ error: { message: 'Invalid OAuth access token' } }, 401)
    );
    const res = await post();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('Invalid OAuth access token');
  });
});
