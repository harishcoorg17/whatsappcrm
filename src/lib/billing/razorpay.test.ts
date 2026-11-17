import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createSubscription,
  interpretEvent,
  razorpayPlanId,
  verifyWebhookSignature,
} from './razorpay';

const sign = (body: string, secret: string) =>
  createHmac('sha256', secret).update(body).digest('hex');

describe('verifyWebhookSignature', () => {
  const body = '{"event":"subscription.activated"}';

  it('accepts a correct signature', () => {
    expect(verifyWebhookSignature(body, sign(body, 's3cret'), 's3cret')).toBe(
      true
    );
  });

  it('rejects a wrong, missing or malformed signature', () => {
    expect(verifyWebhookSignature(body, sign(body, 'other'), 's3cret')).toBe(
      false
    );
    expect(verifyWebhookSignature(body, null, 's3cret')).toBe(false);
    expect(verifyWebhookSignature(body, 'abc', 's3cret')).toBe(false);
  });

  it('rejects a tampered body and an unset secret', () => {
    const sig = sign(body, 's3cret');
    expect(verifyWebhookSignature(`${body} `, sig, 's3cret')).toBe(false);
    expect(verifyWebhookSignature(body, sig, undefined)).toBe(false);
  });
});

describe('razorpayPlanId', () => {
  it('reads the id from the environment', () => {
    const env = { RAZORPAY_PLAN_GROWTH_YEARLY: ' plan_abc ' };
    expect(razorpayPlanId('growth', 'yearly', env)).toBe('plan_abc');
    expect(razorpayPlanId('starter', 'monthly', env)).toBeNull();
  });
});

describe('interpretEvent', () => {
  const subscription = {
    id: 'sub_1',
    customer_id: 'cust_1',
    current_end: 1_800_000_000,
    notes: { tenant_id: 't1', plan: 'growth', interval: 'yearly' },
  };

  it('activates the tenant and records the plan', () => {
    const effect = interpretEvent({
      event: 'subscription.activated',
      payload: { subscription: { entity: subscription } },
    });
    expect(effect).toMatchObject({
      tenantId: 't1',
      subscriptionId: 'sub_1',
      update: {
        subscription_status: 'active',
        plan: 'growth',
        billing_interval: 'yearly',
        razorpay_customer_id: 'cust_1',
      },
      invoice: null,
    });
  });

  it('records an invoice on a charge', () => {
    const effect = interpretEvent({
      event: 'subscription.charged',
      payload: {
        subscription: { entity: subscription },
        payment: {
          entity: {
            id: 'pay_1',
            amount: 589_882,
            tax: 89_982,
            invoice_id: 'inv_1',
            created_at: 1_790_000_000,
          },
        },
      },
    });
    expect(effect?.invoice).toMatchObject({
      razorpay_payment_id: 'pay_1',
      amount_paise: 589_882,
      tax_paise: 89_982,
      currency: 'INR',
    });
    expect(effect?.update.subscription_status).toBe('active');
  });

  it.each([
    ['subscription.halted', 'past_due'],
    ['subscription.cancelled', 'canceled'],
    ['subscription.completed', 'expired'],
  ])('maps %s to %s', (event, status) => {
    expect(
      interpretEvent({
        event,
        payload: { subscription: { entity: subscription } },
      })?.update.subscription_status
    ).toBe(status);
  });

  it('ignores unknown events and tolerates empty notes arrays', () => {
    expect(interpretEvent({ event: 'order.paid' })).toBeNull();
    const effect = interpretEvent({
      event: 'subscription.activated',
      payload: { subscription: { entity: { id: 'sub_2', notes: [] } } },
    });
    expect(effect?.tenantId).toBeNull();
  });
});

describe('createSubscription', () => {
  const env = { RAZORPAY_KEY_ID: 'k', RAZORPAY_KEY_SECRET: 's' };

  it('posts with basic auth and returns the hosted link', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        id: 'sub_9',
        short_url: 'https://rzp.io/i/x',
        status: 'created',
      })
    );
    const result = await createSubscription({
      planId: 'plan_1',
      totalCount: 12,
      notes: { tenant_id: 't1' },
      env,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.short_url).toBe('https://rzp.io/i/x');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://api.razorpay.com/v1/subscriptions');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('k:s').toString('base64')}`
    );
  });

  it('throws on a Razorpay error and when keys are missing', async () => {
    const failing = vi.fn(async () =>
      Response.json(
        { error: { description: 'Plan not found' } },
        { status: 400 }
      )
    );
    await expect(
      createSubscription({
        planId: 'x',
        totalCount: 1,
        notes: {},
        env,
        fetchImpl: failing as unknown as typeof fetch,
      })
    ).rejects.toThrow('Plan not found');
    await expect(
      createSubscription({ planId: 'x', totalCount: 1, notes: {}, env: {} })
    ).rejects.toThrow('not configured');
  });
});
