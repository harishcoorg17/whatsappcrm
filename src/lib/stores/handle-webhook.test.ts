import { describe, expect, test, vi } from 'vitest';
import {
  handleStoreWebhook,
  processDueAbandonedCarts,
  type DueStoreEvent,
  type NewStoreEvent,
  type StoreConnection,
  type StoreDeps,
  type StoreRepo,
} from './handle-webhook';
import { computeStoreSignature } from './signature';

const SECRET = 'shpss_secret';
const connection: StoreConnection = {
  id: 'conn1',
  tenantId: 't1',
  ownerUserId: 'u1',
  platform: 'shopify',
  shopDomain: 'demo.myshopify.com',
  secretEnc: 'enc',
  defaultCountryCode: '91',
  abandonedAfterMinutes: 60,
};

function makeDeps(overrides: Partial<StoreRepo> = {}) {
  const events = new Map<string, NewStoreEvent>();
  const statuses: Array<[string, string, string | undefined]> = [];
  const cancelled: string[] = [];
  const repo: StoreRepo = {
    loadConnection: vi.fn(async () => connection),
    claimEvent: vi.fn(async (e) => {
      if (events.has(e.dedupeKey)) return false;
      events.set(e.dedupeKey, e);
      return true;
    }),
    cancelPendingCarts: vi.fn(async (_c, token) => {
      cancelled.push(token);
    }),
    setEventStatus: vi.fn(async (_c, key, status, error) => {
      statuses.push([key, status, error]);
    }),
    touchConnection: vi.fn(async () => {}),
    findOrCreateContact: vi.fn(async () => 'contact1'),
    claimDueCarts: vi.fn(async () => []),
    ...overrides,
  };
  const runAutomations = vi.fn(async () => {});
  const deps: StoreDeps = {
    repo,
    decrypt: () => SECRET,
    runAutomations,
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  };
  return { deps, repo, events, statuses, cancelled, runAutomations };
}

function call(
  deps: StoreDeps,
  body: unknown,
  topic: string,
  opts: { secret?: string; platform?: 'shopify' | 'woocommerce' } = {}
) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const platform = opts.platform ?? 'shopify';
  const sig = computeStoreSignature(raw, opts.secret ?? SECRET);
  const map: Record<string, string> =
    platform === 'shopify'
      ? { 'x-shopify-hmac-sha256': sig, 'x-shopify-topic': topic }
      : { 'x-wc-webhook-signature': sig, 'x-wc-webhook-topic': topic };
  return handleStoreWebhook(
    { platform, publicId: 'pub', rawBody: raw, getHeader: (n) => map[n] ?? null },
    deps
  );
}

const order = { id: 1, name: '#1', phone: '9876543210', checkout_token: 'tok' };

describe('handleStoreWebhook', () => {
  test('404 when the connection is unknown or disabled', async () => {
    const { deps } = makeDeps({ loadConnection: vi.fn(async () => null) });
    expect((await call(deps, order, 'orders/create')).status).toBe(404);
  });

  test('401 on a bad signature and nothing is recorded', async () => {
    const { deps, repo, runAutomations } = makeDeps();
    const res = await call(deps, order, 'orders/create', { secret: 'wrong' });
    expect(res.status).toBe(401);
    expect(repo.claimEvent).not.toHaveBeenCalled();
    expect(runAutomations).not.toHaveBeenCalled();
  });

  test('order_placed finds the contact and fires the automation with vars', async () => {
    const { deps, runAutomations, statuses, cancelled } = makeDeps();
    const res = await call(deps, order, 'orders/create');
    expect(res.body.status).toBe('processed');
    expect(runAutomations).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        triggerType: 'order_placed',
        contactId: 'contact1',
      })
    );
    expect(statuses[0][1]).toBe('processed');
    expect(cancelled).toEqual(['tok']);
  });

  test('a retried delivery is a duplicate and does not message twice', async () => {
    const { deps, runAutomations } = makeDeps();
    await call(deps, order, 'orders/create');
    const second = await call(deps, order, 'orders/create');
    expect(second.body.status).toBe('duplicate');
    expect(runAutomations).toHaveBeenCalledTimes(1);
  });

  test('cart_abandoned is queued for later, not sent now', async () => {
    const { deps, events, runAutomations } = makeDeps();
    const res = await call(
      deps,
      { id: 9, token: 'tk', phone: '+919000000001' },
      'checkouts/create'
    );
    expect(res.body.status).toBe('queued');
    expect(runAutomations).not.toHaveBeenCalled();
    expect([...events.values()][0].fireAt).toBe('2026-01-01T01:00:00.000Z');
  });

  test('an order without a phone is recorded as failed, no automation', async () => {
    const { deps, runAutomations, events } = makeDeps();
    const res = await call(deps, { id: 3, name: '#3' }, 'orders/create');
    expect(res.body.status).toBe('no_phone');
    expect(runAutomations).not.toHaveBeenCalled();
    expect([...events.values()][0].status).toBe('failed');
  });

  test('unsupported topics are acknowledged and ignored', async () => {
    const { deps, repo } = makeDeps();
    const res = await call(deps, order, 'products/update');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ignored');
    expect(repo.claimEvent).not.toHaveBeenCalled();
  });

  test('a WooCommerce ping (non-JSON body) with a valid signature is accepted', async () => {
    const { deps } = makeDeps({
      loadConnection: vi.fn(async () => ({ ...connection, platform: 'woocommerce' as const })),
    });
    const res = await call(deps, 'webhook_id=5', 'order.created', { platform: 'woocommerce' });
    expect(res.status).toBe(200);
    expect(res.body.reason).toBe('not_json');
  });

  test('automation failure marks the event failed but still acks 200', async () => {
    const { deps, statuses } = makeDeps({
      findOrCreateContact: vi.fn(async () => {
        throw new Error('db down');
      }),
    });
    const res = await call(deps, order, 'orders/create');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('failed');
    expect(statuses[0]).toEqual(['orders/create:1', 'failed', 'db down']);
  });
});

describe('processDueAbandonedCarts', () => {
  test('fires each due cart and counts results', async () => {
    const due: DueStoreEvent[] = [
      {
        connection,
        dedupeKey: 'checkouts/create:9',
        trigger: 'cart_abandoned',
        payload: { phone: '919000000001', name: null, vars: { checkout_url: 'u' } },
      },
    ];
    const { deps, runAutomations } = makeDeps({ claimDueCarts: vi.fn(async () => due) });
    const result = await processDueAbandonedCarts(deps);
    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(runAutomations).toHaveBeenCalledWith(
      expect.objectContaining({ triggerType: 'cart_abandoned' })
    );
  });
});
