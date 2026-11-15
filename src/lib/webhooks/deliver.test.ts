import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTO_DISABLE_AFTER_FAILURES,
  deliverToEndpoint,
  dispatchWebhookEvent,
  type DeliveryDeps,
  type WebhookEndpoint,
} from './deliver';
import { buildEnvelope } from './events';
import { SIGNATURE_HEADER, verifySignature } from './signing';

interface FakeState {
  deliveries: Array<Record<string, unknown>>;
  endpointUpdates: Array<Record<string, unknown>>;
  endpoints: WebhookEndpoint[];
  loadError: { message: string } | null;
  filters: Record<string, unknown>;
}

const state: FakeState = {
  deliveries: [],
  endpointUpdates: [],
  endpoints: [],
  loadError: null,
  filters: {},
};

function chain(table: string) {
  const query: Record<string, unknown> = {};
  for (const name of ['select', 'order', 'range', 'in', 'delete']) {
    query[name] = () => query;
  }
  query.eq = (column: string, value: unknown) => {
    state.filters[column] = value;
    return query;
  };
  query.contains = (column: string, value: unknown) => {
    state.filters[column] = value;
    return query;
  };
  query.insert = async (values: Record<string, unknown>) => {
    state.deliveries.push(values);
    return { error: null };
  };
  query.update = (values: Record<string, unknown>) => {
    state.endpointUpdates.push(values);
    return query;
  };
  query.then = (onFulfilled: (v: unknown) => unknown) =>
    Promise.resolve(
      table === 'crm_webhook_endpoints'
        ? { data: state.endpoints, error: state.loadError }
        : { data: [], error: null }
    ).then(onFulfilled);
  return query;
}

const db = {
  from: (table: string) => chain(table),
} as unknown as SupabaseClient;

const SECRET = 'whsec_unit';
const endpoint: WebhookEndpoint = {
  id: 'e1',
  tenant_id: 't1',
  url: 'https://hooks.example.com/in',
  secret_enc: 'enc',
  events: ['message.received'],
  consecutive_failures: 0,
};
const envelope = buildEnvelope(
  'message.received',
  't1',
  { text: 'hi' },
  { id: 'evt-1' }
);

const sleeps: number[] = [];
const baseDeps = (over: Partial<DeliveryDeps> = {}): DeliveryDeps => ({
  decryptSecret: () => SECRET,
  assertUrl: async (raw) => ({ ok: true, url: new URL(raw) }),
  sleep: async (ms) => {
    sleeps.push(ms);
  },
  nowSeconds: () => 1_800_000_000,
  ...over,
});

const respond = (status: number) => async () => new Response('', { status });

beforeEach(() => {
  state.deliveries = [];
  state.endpointUpdates = [];
  state.endpoints = [];
  state.loadError = null;
  state.filters = {};
  sleeps.length = 0;
});

describe('deliverToEndpoint', () => {
  it('sends a correctly signed request and records the success', async () => {
    const fetchImpl = vi.fn(respond(200));
    const result = await deliverToEndpoint(
      db,
      endpoint,
      envelope,
      baseDeps({ fetchImpl: fetchImpl as unknown as typeof fetch })
    );

    expect(result).toMatchObject({ ok: true, status: 200, attempts: 1 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://hooks.example.com/in');
    expect(init.redirect).toBe('manual');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-ConverMesh-Event']).toBe('message.received');
    expect(headers['X-ConverMesh-Delivery']).toBe('evt-1');
    expect(
      verifySignature(SECRET, init.body as string, headers[SIGNATURE_HEADER], {
        nowSeconds: 1_800_000_000,
      })
    ).toBe(true);
    expect(JSON.parse(init.body as string)).toMatchObject({
      id: 'evt-1',
      type: 'message.received',
      tenantId: 't1',
      data: { text: 'hi' },
    });

    expect(state.deliveries[0]).toMatchObject({
      status: 'success',
      http_status: 200,
      attempt: 1,
    });
    expect(state.endpointUpdates[0]).toMatchObject({ consecutive_failures: 0 });
  });

  it('retries a server error on the 2s schedule and succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }));
    const result = await deliverToEndpoint(
      db,
      endpoint,
      envelope,
      baseDeps({ fetchImpl: fetchImpl as unknown as typeof fetch })
    );
    expect(result).toMatchObject({ ok: true, attempts: 2 });
    expect(sleeps).toEqual([2000]);
    expect(state.deliveries.map((d) => d.status)).toEqual([
      'failed',
      'success',
    ]);
  });

  it('gives up after three attempts on network errors', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    const result = await deliverToEndpoint(
      db,
      endpoint,
      envelope,
      baseDeps({ fetchImpl: fetchImpl as unknown as typeof fetch })
    );
    expect(result).toMatchObject({
      ok: false,
      attempts: 3,
      error: 'ECONNRESET',
    });
    expect(sleeps).toEqual([2000, 10000]);
    expect(state.endpointUpdates[0]).toMatchObject({ consecutive_failures: 1 });
  });

  it('does not retry a client error such as 400 or 404', async () => {
    const fetchImpl = vi.fn(respond(404));
    const result = await deliverToEndpoint(
      db,
      endpoint,
      envelope,
      baseDeps({ fetchImpl: fetchImpl as unknown as typeof fetch })
    );
    expect(result).toMatchObject({ ok: false, status: 404, attempts: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries 429 and 408', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response('', { status: 408 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }));
    const result = await deliverToEndpoint(
      db,
      endpoint,
      envelope,
      baseDeps({ fetchImpl: fetchImpl as unknown as typeof fetch })
    );
    expect(result).toMatchObject({ ok: true, attempts: 3 });
  });

  it('treats a redirect as a failure instead of following it', async () => {
    const fetchImpl = vi.fn(respond(302));
    const result = await deliverToEndpoint(
      db,
      endpoint,
      envelope,
      baseDeps({ fetchImpl: fetchImpl as unknown as typeof fetch })
    );
    expect(result).toMatchObject({ ok: false, status: 302, attempts: 1 });
  });

  it('never calls an address that fails the safety check', async () => {
    const fetchImpl = vi.fn(respond(200));
    const result = await deliverToEndpoint(
      db,
      endpoint,
      envelope,
      baseDeps({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        assertUrl: async () => ({
          ok: false,
          error: 'That address is not reachable from the internet',
        }),
      })
    );
    expect(result).toMatchObject({ ok: false, attempts: 1 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(state.deliveries[0]).toMatchObject({ status: 'failed' });
  });

  it('turns the endpoint off after too many failures in a row', async () => {
    const fetchImpl = vi.fn(respond(400));
    await deliverToEndpoint(
      db,
      { ...endpoint, consecutive_failures: AUTO_DISABLE_AFTER_FAILURES - 1 },
      envelope,
      baseDeps({ fetchImpl: fetchImpl as unknown as typeof fetch })
    );
    expect(state.endpointUpdates[0]).toMatchObject({
      enabled: false,
      consecutive_failures: AUTO_DISABLE_AFTER_FAILURES,
    });
    expect(String(state.endpointUpdates[0].disabled_reason)).toContain(
      'failed deliveries'
    );
  });

  it('reports an unreadable secret without sending anything', async () => {
    const fetchImpl = vi.fn(respond(200));
    const result = await deliverToEndpoint(
      db,
      endpoint,
      envelope,
      baseDeps({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        decryptSecret: () => {
          throw new Error('bad key');
        },
      })
    );
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('dispatchWebhookEvent', () => {
  it('delivers to every matching endpoint', async () => {
    state.endpoints = [endpoint, { ...endpoint, id: 'e2' }];
    const fetchImpl = vi.fn(respond(200));
    await dispatchWebhookEvent(
      db,
      { tenantId: 't1', type: 'message.received', data: { x: 1 } },
      baseDeps({ fetchImpl: fetchImpl as unknown as typeof fetch })
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(state.filters.tenant_id).toBe('t1');
    expect(state.filters.enabled).toBe(true);
    expect(state.filters.events).toEqual(['message.received']);
  });

  it('does nothing when no endpoint subscribed or the table is missing', async () => {
    const fetchImpl = vi.fn(respond(200));
    await dispatchWebhookEvent(
      db,
      { tenantId: 't1', type: 'message.sent', data: {} },
      baseDeps({ fetchImpl: fetchImpl as unknown as typeof fetch })
    );
    state.loadError = { message: 'relation does not exist' };
    await expect(
      dispatchWebhookEvent(
        db,
        { tenantId: 't1', type: 'message.sent', data: {} },
        baseDeps({ fetchImpl: fetchImpl as unknown as typeof fetch })
      )
    ).resolves.toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('keeps delivering to other endpoints when one fails', async () => {
    state.endpoints = [
      endpoint,
      { ...endpoint, id: 'e2', url: 'https://other.example.com/in' },
    ];
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes('other')
        ? new Response('', { status: 200 })
        : new Response('', { status: 400 })
    );
    await dispatchWebhookEvent(
      db,
      { tenantId: 't1', type: 'message.received', data: {} },
      baseDeps({ fetchImpl: fetchImpl as unknown as typeof fetch })
    );
    expect(state.deliveries.map((d) => d.status).sort()).toEqual([
      'failed',
      'success',
    ]);
  });
});
