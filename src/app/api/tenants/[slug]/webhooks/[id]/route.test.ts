import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeState {
  userId: string | null;
  found: boolean;
  tenantFilter: unknown;
  updates: Array<Record<string, unknown>>;
  deletes: number;
}

const state: FakeState = {
  userId: 'owner1',
  found: true,
  tenantFilter: null,
  updates: [],
  deletes: 0,
};

const TENANT = {
  id: 't1',
  owner_user_id: 'owner1',
  phone_number_id: null,
  waba_id: null,
  access_token_enc: null,
};

const ROW = {
  id: 'e1',
  url: 'https://ok.example.com/hook',
  description: null,
  events: ['message.received'],
  enabled: false,
  consecutive_failures: 10,
  last_success_at: null,
  last_failure_at: null,
  disabled_reason: 'Turned off after 10 failed deliveries in a row',
  created_at: '2026-01-01T00:00:00Z',
};

function chain(resolve: () => unknown) {
  const query: Record<string, unknown> = {};
  for (const name of ['select', 'order', 'limit']) query[name] = () => query;
  query.eq = (column: string, value: unknown) => {
    if (column === 'tenant_id') state.tenantFilter = value;
    return query;
  };
  query.maybeSingle = async () => resolve();
  query.single = async () => resolve();
  query.then = (onFulfilled: (v: unknown) => unknown) =>
    Promise.resolve(resolve()).then(onFulfilled);
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
      if (table === 'crm_platform_admins')
        return chain(() => ({ data: null, error: null }));
      if (table === 'crm_tenants')
        return chain(() => ({ data: TENANT, error: null }));
      if (table === 'crm_tenant_members')
        return chain(() => ({ data: null, error: null }));
      if (table === 'crm_webhook_deliveries') {
        return chain(() => ({
          data: [{ id: 'd1', status: 'success' }],
          error: null,
        }));
      }
      const q = chain(() => ({ data: state.found ? ROW : null, error: null }));
      q.update = (values: Record<string, unknown>) => {
        state.updates.push(values);
        return q;
      };
      q.delete = () => {
        state.deletes += 1;
        return q;
      };
      return q;
    },
  }),
}));

vi.mock('@/lib/webhooks/url-safety', () => ({
  assertSafeWebhookUrl: async (raw: string) =>
    raw.startsWith('https://ok.example.com')
      ? { ok: true, url: new URL(raw) }
      : { ok: false, error: 'That address is not reachable from the internet' },
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: (value: string) => `enc(${value})`,
  decrypt: (value: string) => value,
}));

import { DELETE, GET, PATCH } from './route';

const ctx = { params: Promise.resolve({ slug: 'amstago', id: 'e1' }) };

const patch = (body: unknown) =>
  PATCH(
    new NextRequest('http://localhost/x', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    ctx
  );

beforeEach(() => {
  state.userId = 'owner1';
  state.found = true;
  state.tenantFilter = null;
  state.updates = [];
  state.deletes = 0;
});

describe('GET /api/tenants/[slug]/webhooks/[id]', () => {
  it('returns the endpoint and its recent deliveries, scoped to the tenant', async () => {
    const res = await GET(new NextRequest('http://localhost/x'), ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      endpoint: { id: string };
      deliveries: unknown[];
    };
    expect(body.endpoint.id).toBe('e1');
    expect(body.deliveries).toHaveLength(1);
    expect(state.tenantFilter).toBe('t1');
  });

  it('returns 404 for an endpoint that is not on this tenant', async () => {
    state.found = false;
    expect((await GET(new NextRequest('http://localhost/x'), ctx)).status).toBe(
      404
    );
  });

  it('rejects a stranger', async () => {
    state.userId = 'stranger';
    expect((await GET(new NextRequest('http://localhost/x'), ctx)).status).toBe(
      403
    );
  });
});

describe('PATCH /api/tenants/[slug]/webhooks/[id]', () => {
  it('turning an endpoint back on clears its failure state', async () => {
    const res = await patch({ enabled: true });
    expect(res.status).toBe(200);
    expect(state.updates[0]).toEqual({
      enabled: true,
      consecutive_failures: 0,
      disabled_reason: null,
    });
  });

  it('rotates the secret, returns it once and stores it encrypted', async () => {
    const res = await patch({ rotateSecret: true });
    const body = (await res.json()) as { secret: string; endpoint: unknown };
    expect(body.secret).toMatch(/^whsec_/);
    expect(JSON.stringify(body.endpoint)).not.toContain(body.secret);
    expect(state.updates[0]).toEqual({ secret_enc: `enc(${body.secret})` });
  });

  it('updates the URL, events and description with validation', async () => {
    const ok = await patch({
      url: 'https://ok.example.com/new',
      events: ['message.sent'],
      description: ' Zap ',
    });
    expect(ok.status).toBe(200);
    expect(state.updates[0]).toMatchObject({
      url: 'https://ok.example.com/new',
      events: ['message.sent'],
      description: 'Zap',
    });
  });

  it('refuses an unsafe URL, bad events, a non-boolean flag and an empty change', async () => {
    expect((await patch({ url: 'https://169.254.169.254/x' })).status).toBe(
      400
    );
    expect((await patch({ events: ['bogus'] })).status).toBe(400);
    expect((await patch({ enabled: 'yes' })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
    expect(state.updates).toEqual([]);
  });

  it('returns 404 for an unknown endpoint', async () => {
    state.found = false;
    expect((await patch({ enabled: true })).status).toBe(404);
  });
});

describe('DELETE /api/tenants/[slug]/webhooks/[id]', () => {
  it('deletes the endpoint', async () => {
    const res = await DELETE(
      new NextRequest('http://localhost/x', { method: 'DELETE' }),
      ctx
    );
    expect(res.status).toBe(200);
    expect(state.deletes).toBe(1);
  });

  it('returns 404 for an unknown endpoint without deleting', async () => {
    state.found = false;
    const res = await DELETE(
      new NextRequest('http://localhost/x', { method: 'DELETE' }),
      ctx
    );
    expect(res.status).toBe(404);
    expect(state.deletes).toBe(0);
  });
});
