import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetRateLimitForTests } from '@/lib/rate-limit';

const state = {
  userId: 'owner1' as string | null,
  callerRole: null as 'admin' | 'agent' | null,
  subscriptionStatus: 'trialing',
  saved: [] as Array<Record<string, unknown>>,
  razorpayBodies: [] as Array<Record<string, unknown>>,
  razorpayFails: false,
};

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: state.userId ? { id: state.userId } : null },
      }),
    },
  }),
}));

function chain(resolve: (f: Record<string, unknown>) => unknown) {
  const filters: Record<string, unknown> = {};
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = (c: string, v: unknown) => {
    filters[c] = v;
    return q;
  };
  q.maybeSingle = async () => resolve(filters);
  return q;
}

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'crm_platform_admins') {
        return chain(() => ({ data: null, error: null }));
      }
      if (table === 'crm_tenant_members') {
        return chain(() => ({
          data: state.callerRole ? { role: state.callerRole } : null,
          error: null,
        }));
      }
      const q = chain((filters) =>
        'slug' in filters
          ? {
              data: {
                id: 't1',
                owner_user_id: 'owner1',
                phone_number_id: null,
                waba_id: null,
                access_token_enc: null,
              },
              error: null,
            }
          : { data: { subscription_status: state.subscriptionStatus }, error: null }
      );
      q.update = (values: Record<string, unknown>) => ({
        eq: async () => {
          state.saved.push(values);
          return { error: null };
        },
      });
      return q;
    },
  }),
}));

vi.stubGlobal(
  'fetch',
  vi.fn(async (_url: string, init: RequestInit) => {
    state.razorpayBodies.push(JSON.parse(String(init.body)));
    if (state.razorpayFails) {
      return Response.json({ error: { description: 'bad' } }, { status: 400 });
    }
    return Response.json({
      id: 'sub_new',
      short_url: 'https://rzp.io/i/new',
      status: 'created',
    });
  })
);

import { POST } from './route';

const PARAMS = { params: Promise.resolve({ slug: 'acme' }) };
const post = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/tenants/acme/billing/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    PARAMS
  );

beforeEach(() => {
  __resetRateLimitForTests();
  vi.stubEnv('RAZORPAY_KEY_ID', 'key');
  vi.stubEnv('RAZORPAY_KEY_SECRET', 'secret');
  vi.stubEnv('RAZORPAY_PLAN_GROWTH_MONTHLY', 'plan_growth_m');
  state.userId = 'owner1';
  state.callerRole = null;
  state.subscriptionStatus = 'trialing';
  state.saved = [];
  state.razorpayBodies = [];
  state.razorpayFails = false;
});

describe('POST /api/tenants/[slug]/billing/subscribe', () => {
  it('creates a subscription tagged with the tenant and returns the link', async () => {
    const res = await post({ plan: 'growth', interval: 'monthly' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ url: 'https://rzp.io/i/new' });
    expect(state.razorpayBodies[0]).toMatchObject({
      plan_id: 'plan_growth_m',
      notes: { tenant_id: 't1', plan: 'growth', interval: 'monthly' },
    });
    expect(state.saved[0]).toEqual({ razorpay_subscription_id: 'sub_new' });
  });

  it('does not let a team admin or stranger buy', async () => {
    state.userId = 'admin1';
    state.callerRole = 'admin';
    expect((await post({ plan: 'growth', interval: 'monthly' })).status).toBe(403);
  });

  it('validates plan and interval; Scale is not sold here', async () => {
    expect((await post({ plan: 'scale', interval: 'monthly' })).status).toBe(400);
    expect((await post({ plan: 'growth', interval: 'weekly' })).status).toBe(400);
  });

  it('returns 503 when no Razorpay plan id is configured', async () => {
    expect((await post({ plan: 'starter', interval: 'yearly' })).status).toBe(503);
  });

  it('refuses a second subscription while one is active', async () => {
    state.subscriptionStatus = 'active';
    expect((await post({ plan: 'growth', interval: 'monthly' })).status).toBe(409);
  });

  it('maps a Razorpay failure to 502 without leaking details', async () => {
    state.razorpayFails = true;
    const res = await post({ plan: 'growth', interval: 'monthly' });
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('bad');
    expect(state.saved).toEqual([]);
  });
});
