import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const SECRET = 'whsec_test';

interface FakeState {
  events: Set<string>;
  tenantUpdates: Array<Record<string, unknown>>;
  /** Rows the tenant update "matches". */
  matchedRows: number;
  invoices: Array<Record<string, unknown>>;
  failTenantUpdate: boolean;
}
const state: FakeState = {
  events: new Set(),
  tenantUpdates: [],
  matchedRows: 1,
  invoices: [],
  failTenantUpdate: false,
};

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'crm_billing_events') {
        return {
          insert: async (row: { event_id: string }) => {
            if (state.events.has(row.event_id)) {
              return { error: { code: '23505', message: 'duplicate' } };
            }
            state.events.add(row.event_id);
            return { error: null };
          },
          delete: () => ({
            eq: async (_c: string, id: string) => {
              state.events.delete(id);
              return { error: null };
            },
          }),
        };
      }
      if (table === 'crm_invoices') {
        return {
          upsert: async (row: Record<string, unknown>) => {
            state.invoices.push(row);
            return { error: null };
          },
        };
      }
      // crm_tenants
      return {
        update: (values: Record<string, unknown>) => {
          const q = {
            eq: () => q,
            select: async () => {
              if (state.failTenantUpdate) {
                return { data: null, error: { message: 'db down' } };
              }
              state.tenantUpdates.push(values);
              return {
                data: Array.from({ length: state.matchedRows }, () => ({
                  id: 't1',
                })),
                error: null,
              };
            },
          };
          return q;
        },
      };
    },
  }),
}));

import { POST } from './route';

const sign = (body: string, secret = SECRET) =>
  createHmac('sha256', secret).update(body).digest('hex');

function call(payload: unknown, opts: { id?: string | null; sig?: string } = {}) {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    'x-razorpay-signature': opts.sig ?? sign(body),
  };
  if (opts.id !== null) headers['x-razorpay-event-id'] = opts.id ?? 'evt_1';
  return POST(
    new NextRequest('http://localhost/api/webhooks/razorpay', {
      method: 'POST',
      headers,
      body,
    })
  );
}

const charged = {
  event: 'subscription.charged',
  payload: {
    subscription: {
      entity: {
        id: 'sub_1',
        customer_id: 'cust_1',
        notes: { tenant_id: 't1', plan: 'growth', interval: 'monthly' },
      },
    },
    payment: { entity: { id: 'pay_1', amount: 589_882, tax: 89_982 } },
  },
};

beforeEach(() => {
  vi.stubEnv('RAZORPAY_WEBHOOK_SECRET', SECRET);
  state.events = new Set();
  state.tenantUpdates = [];
  state.invoices = [];
  state.matchedRows = 1;
  state.failTenantUpdate = false;
});

describe('POST /api/webhooks/razorpay', () => {
  it('rejects a bad signature and does nothing', async () => {
    const res = await call(charged, { sig: 'nope' });
    expect(res.status).toBe(401);
    expect(state.tenantUpdates).toEqual([]);
    expect(state.events.size).toBe(0);
  });

  it('rejects everything when the secret is not configured', async () => {
    vi.stubEnv('RAZORPAY_WEBHOOK_SECRET', '');
    expect((await call(charged)).status).toBe(401);
  });

  it('requires an event id', async () => {
    expect((await call(charged, { id: null })).status).toBe(400);
  });

  it('activates the tenant and stores the invoice', async () => {
    const res = await call(charged);
    expect(res.status).toBe(200);
    expect(state.tenantUpdates[0]).toMatchObject({
      subscription_status: 'active',
      plan: 'growth',
    });
    expect(state.invoices[0]).toMatchObject({
      tenant_id: 't1',
      razorpay_payment_id: 'pay_1',
      amount_paise: 589_882,
    });
  });

  it('processes a repeated event id once', async () => {
    await call(charged, { id: 'evt_dup' });
    const second = await call(charged, { id: 'evt_dup' });
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ duplicate: true });
    expect(state.tenantUpdates).toHaveLength(1);
    expect(state.invoices).toHaveLength(1);
  });

  it('stores no invoice when the subscription is not the tenant\'s current one', async () => {
    state.matchedRows = 0;
    expect((await call(charged)).status).toBe(200);
    expect(state.invoices).toEqual([]);
  });

  it('releases the event id on failure so Razorpay can retry', async () => {
    state.failTenantUpdate = true;
    expect((await call(charged, { id: 'evt_fail' })).status).toBe(500);
    expect(state.events.has('evt_fail')).toBe(false);
    state.failTenantUpdate = false;
    expect((await call(charged, { id: 'evt_fail' })).status).toBe(200);
  });

  it('acknowledges events it does not use', async () => {
    const res = await call({ event: 'payment.authorized' }, { id: 'evt_x' });
    expect(res.status).toBe(200);
    expect(state.tenantUpdates).toEqual([]);
  });
});
