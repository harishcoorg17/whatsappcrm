import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetRateLimitForTests } from '@/lib/rate-limit';

interface Credentials {
  phoneNumberId: string;
  accessToken: string;
  wabaId: string | null;
  source: 'tenant' | 'legacy';
}

interface FakeState {
  userId: string | null;
  credentials: Credentials | null;
}

const state: FakeState = { userId: 'u1', credentials: null };

function templatesQuery() {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: null, error: null }),
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

const sendTemplate = vi.fn();
vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTemplateMessage: (...args: unknown[]) => sendTemplate(...args),
}));

async function post(body: Record<string, unknown>) {
  const { POST } = await import('./route');
  return POST(
    new Request('http://localhost/api/whatsapp/broadcast', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  );
}

const BODY = {
  template_name: 'booking_confirmation',
  phone_numbers: ['+919876543210', '+919876543211'],
};

beforeEach(() => {
  __resetRateLimitForTests();
  sendTemplate.mockReset();
  loadCredentials.mockClear();
  Object.assign(state, { userId: 'u1', credentials: null });
});

describe('POST /api/whatsapp/broadcast', () => {
  it('rejects a request with no session', async () => {
    state.userId = null;
    expect((await post(BODY)).status).toBe(401);
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it('asks to set up WhatsApp when nothing is connected', async () => {
    const res = await post(BODY);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not configured/i);
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it('sends with a number connected through Tenants', async () => {
    state.credentials = {
      phoneNumberId: 'pn-amstago',
      accessToken: 'tenant-token',
      wabaId: 'waba-1',
      source: 'tenant',
    };
    sendTemplate.mockResolvedValue({ messageId: 'wamid.1' });

    const res = await post(BODY);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ total: 2, sent: 2, failed: 0 });
    expect(sendTemplate).toHaveBeenCalledTimes(2);
    expect(sendTemplate.mock.calls[0][0]).toMatchObject({
      phoneNumberId: 'pn-amstago',
      accessToken: 'tenant-token',
      templateName: 'booking_confirmation',
    });
    expect(loadCredentials).toHaveBeenCalledTimes(1);
  });

  it('reports per-recipient failures without stopping the campaign', async () => {
    state.credentials = {
      phoneNumberId: 'pn-amstago',
      accessToken: 'tenant-token',
      wabaId: 'waba-1',
      source: 'tenant',
    };
    sendTemplate
      .mockRejectedValueOnce(new Error('Template not approved'))
      .mockResolvedValueOnce({ messageId: 'wamid.2' });

    const res = await post(BODY);
    const body = await res.json();

    expect(body).toMatchObject({ total: 2, sent: 1, failed: 1 });
    expect(body.results[0]).toMatchObject({
      status: 'failed',
      error: 'Template not approved',
    });
  });
});
