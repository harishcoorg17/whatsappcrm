import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetRateLimitForTests, RATE_LIMITS } from '@/lib/rate-limit';

const authenticate = vi.fn();
vi.mock('@/lib/integrations/api-key', () => ({
  authenticateApiKey: (...args: unknown[]) => authenticate(...args),
}));

const execute = vi.fn();
vi.mock('@/lib/integrations/send-template', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/integrations/send-template')>();
  return {
    ...original,
    executeSendTemplate: (...args: unknown[]) => execute(...args),
  };
});

vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => ({}) }));
vi.mock('@/lib/whatsapp/meta-api', () => ({ sendTemplateMessage: vi.fn() }));
vi.mock('@/lib/whatsapp/credentials', () => ({
  loadWhatsAppCredentials: vi.fn(),
}));
vi.mock('@/lib/integrations/record-outbound', () => ({
  recordOutboundTemplate: vi.fn(),
}));

const AUTH = { keyId: 'k1', tenantId: 't1', ownerUserId: 'u1' };

const BODY = {
  to: '+919876543210',
  template_name: 'tour_purchase_confirmation',
  reference: 'booking-123:confirmation',
  params: ['Asha', 'Kerala'],
};

async function post(body: unknown, headers: Record<string, string> = {}) {
  const { POST } = await import('./route');
  return POST(
    new Request('http://localhost/api/integrations/send-template', {
      method: 'POST',
      headers: { authorization: 'Bearer amst_live_test', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  __resetRateLimitForTests();
  authenticate.mockReset().mockResolvedValue(AUTH);
  execute.mockReset().mockResolvedValue({
    ok: true,
    status: 'sent',
    messageId: 'wamid.1',
    conversationId: 'c1',
  });
});

describe('POST /api/integrations/send-template', () => {
  it('rejects a request without a valid key and does no work', async () => {
    authenticate.mockResolvedValue(null);
    const res = await post(BODY);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      ok: false,
      error: { code: 'unauthorized' },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('passes the Authorization header to key authentication', async () => {
    await post(BODY, { authorization: 'Bearer amst_live_abc' });
    expect(authenticate.mock.calls[0][1]).toBe('Bearer amst_live_abc');
  });

  it('rejects a body that is not JSON', async () => {
    const res = await post('not json');
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('invalid_json');
  });

  it('rejects an invalid request with a specific message', async () => {
    const res = await post({ ...BODY, reference: '' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('invalid_request');
    expect(body.error.message).toMatch(/reference/);
    expect(execute).not.toHaveBeenCalled();
  });

  it('sends for the key’s tenant and returns the message ids', async () => {
    const res = await post(BODY);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      status: 'sent',
      message_id: 'wamid.1',
      conversation_id: 'c1',
    });
    expect(execute.mock.calls[0][0]).toMatchObject({
      auth: AUTH,
      input: {
        to: '+919876543210',
        templateName: 'tour_purchase_confirmation',
        language: 'en_US',
        reference: 'booking-123:confirmation',
        params: ['Asha', 'Kerala'],
      },
    });
  });

  it('reports a repeated reference as a duplicate, still a success', async () => {
    execute.mockResolvedValue({
      ok: true,
      status: 'duplicate',
      messageId: 'wamid.1',
      conversationId: 'c1',
    });
    const res = await post(BODY);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('duplicate');
  });

  it.each([
    ['template_not_found', 404],
    ['template_not_approved', 409],
    ['invalid_params', 422],
    ['send_failed', 502],
  ])('maps %s to HTTP %i', async (code, httpStatus) => {
    execute.mockResolvedValue({
      ok: false,
      code,
      message: 'nope',
      httpStatus,
    });
    const res = await post(BODY);
    expect(res.status).toBe(httpStatus);
    expect(await res.json()).toEqual({
      ok: false,
      error: { code, message: 'nope' },
    });
  });

  it('limits how fast one key can send', async () => {
    const { limit } = RATE_LIMITS.integrationSend;
    for (let i = 0; i < limit; i++) {
      expect((await post(BODY)).status).toBe(200);
    }
    expect((await post(BODY)).status).toBe(429);
  });

  it('counts each key separately', async () => {
    const { limit } = RATE_LIMITS.integrationSend;
    for (let i = 0; i < limit; i++) await post(BODY);
    authenticate.mockResolvedValue({ ...AUTH, keyId: 'k2' });
    expect((await post(BODY)).status).toBe(200);
  });
});
