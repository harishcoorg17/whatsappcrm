import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetRateLimitForTests } from '@/lib/rate-limit';

interface FakeState {
  userId: string | null;
  callerRole: 'admin' | 'agent' | null;
  endpoints: Array<Record<string, unknown>>;
  count: number;
  inserted: Array<Record<string, unknown>>;
}

const state: FakeState = {
  userId: 'owner1',
  callerRole: null,
  endpoints: [],
  count: 0,
  inserted: [],
};

const TENANT = {
  id: 't1',
  owner_user_id: 'owner1',
  phone_number_id: null,
  waba_id: null,
  access_token_enc: null,
};

const PUBLIC_ROW = {
  id: 'e1',
  url: 'https://ok.example.com/hook',
  description: null,
  events: ['message.received'],
  enabled: true,
  consecutive_failures: 0,
  last_success_at: null,
  last_failure_at: null,
  disabled_reason: null,
  created_at: '2026-01-01T00:00:00Z',
};

function chain(resolve: (filters: Record<string, unknown>) => unknown) {
  const filters: Record<string, unknown> = {};
  const query: Record<string, unknown> = {};
  query.select = (_c?: string, opts?: { head?: boolean }) => {
    if (opts?.head) filters.__count = true;
    return query;
  };
  query.eq = (column: string, value: unknown) => {
    filters[column] = value;
    return query;
  };
  query.order = () => query;
  query.maybeSingle = async () => resolve(filters);
  query.single = async () => resolve(filters);
  query.then = (onFulfilled: (v: unknown) => unknown) =>
    Promise.resolve(resolve(filters)).then(onFulfilled);
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
      if (table === 'crm_tenant_members') {
        return chain(() => ({
          data: state.callerRole ? { role: state.callerRole } : null,
          error: null,
        }));
      }
      // crm_webhook_endpoints
      const q = chain((filters) =>
        filters.__count
          ? { count: state.count, error: null }
          : { data: state.endpoints, error: null }
      );
      q.insert = (values: Record<string, unknown>) => {
        state.inserted.push(values);
        return chain(() => ({
          data: { ...PUBLIC_ROW, url: values.url, events: values.events },
          error: null,
        }));
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

import { GET, POST } from './route';

const PARAMS = { params: Promise.resolve({ slug: 'amstago' }) };

const post = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    PARAMS
  );

beforeEach(() => {
  __resetRateLimitForTests();
  state.userId = 'owner1';
  state.callerRole = null;
  state.endpoints = [PUBLIC_ROW];
  state.count = 0;
  state.inserted = [];
});

describe('GET /api/tenants/[slug]/webhooks', () => {
  it('lists endpoints without any secret', async () => {
    const res = await GET(new NextRequest('http://localhost/x'), PARAMS);
    expect(res.status).toBe(200);
    const text = JSON.stringify(await res.json());
    expect(text).toContain('ok.example.com');
    expect(text).not.toContain('secret');
  });

  it('rejects a stranger and a plain agent but lets a team admin in', async () => {
    state.userId = 'stranger';
    expect(
      (await GET(new NextRequest('http://localhost/x'), PARAMS)).status
    ).toBe(403);
    state.userId = 'a1';
    state.callerRole = 'agent';
    expect(
      (await GET(new NextRequest('http://localhost/x'), PARAMS)).status
    ).toBe(403);
    state.callerRole = 'admin';
    expect(
      (await GET(new NextRequest('http://localhost/x'), PARAMS)).status
    ).toBe(200);
  });
});

describe('POST /api/tenants/[slug]/webhooks', () => {
  it('creates an endpoint and returns the secret once, stored encrypted', async () => {
    const res = await post({
      url: 'https://ok.example.com/hook',
      events: ['message.sent'],
      description: ' CRM sync ',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      secret: string;
      endpoint: Record<string, unknown>;
    };
    expect(body.secret).toMatch(/^whsec_[0-9a-f]{48}$/);
    expect(JSON.stringify(body.endpoint)).not.toContain(body.secret);
    expect(state.inserted[0]).toMatchObject({
      tenant_id: 't1',
      description: 'CRM sync',
      events: ['message.sent'],
      secret_enc: `enc(${body.secret})`,
      created_by: 'owner1',
    });
  });

  it('defaults to all events', async () => {
    await post({ url: 'https://ok.example.com/hook' });
    expect(state.inserted[0].events).toHaveLength(4);
  });

  it('refuses an unsafe or missing URL', async () => {
    expect((await post({ url: 'https://10.0.0.5/hook' })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect(state.inserted).toEqual([]);
  });

  it('refuses unknown events and an empty events list', async () => {
    expect(
      (await post({ url: 'https://ok.example.com/hook', events: ['nope'] }))
        .status
    ).toBe(400);
    expect(
      (await post({ url: 'https://ok.example.com/hook', events: [] })).status
    ).toBe(400);
  });

  it('refuses a very long description and enforces the endpoint limit', async () => {
    expect(
      (
        await post({
          url: 'https://ok.example.com/hook',
          description: 'x'.repeat(121),
        })
      ).status
    ).toBe(400);
    state.count = 10;
    expect((await post({ url: 'https://ok.example.com/hook' })).status).toBe(
      400
    );
  });

  it('rejects unauthenticated requests', async () => {
    state.userId = null;
    expect((await post({ url: 'https://ok.example.com/hook' })).status).toBe(
      401
    );
  });
});
