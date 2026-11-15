import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeState {
  userId: string | null;
  row: {
    business_hours: unknown;
    away_message: string | null;
    auto_assign: boolean;
  } | null;
  updates: Array<Record<string, unknown>>;
}

const state: FakeState = { userId: 'owner1', row: null, updates: [] };

const TENANT = {
  id: 't1',
  owner_user_id: 'owner1',
  phone_number_id: null,
  waba_id: null,
  access_token_enc: null,
};

function chain(resolve: () => unknown) {
  const query: Record<string, unknown> = {};
  query.select = () => query;
  query.eq = () => query;
  query.maybeSingle = async () => resolve();
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
      if (table === 'crm_tenant_members')
        return chain(() => ({ data: null, error: null }));
      // crm_tenants: the authorization lookup and the settings row.
      const q = chain(() => ({
        data: { ...TENANT, ...(state.row ?? {}) },
        error: null,
      }));
      q.update = (values: Record<string, unknown>) => {
        state.updates.push(values);
        return q;
      };
      return q;
    },
  }),
}));

import { GET, PUT } from './route';

const PARAMS = { params: Promise.resolve({ slug: 'amstago' }) };

const put = (body: unknown) =>
  PUT(
    new NextRequest('http://localhost/x', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    PARAMS
  );

const hours = {
  enabled: true,
  timezone: 'Asia/Kolkata',
  days: { mon: { open: '09:00', close: '18:00' } },
};

beforeEach(() => {
  state.userId = 'owner1';
  state.row = null;
  state.updates = [];
});

describe('GET /api/tenants/[slug]/routing', () => {
  it('returns defaults when nothing is configured', async () => {
    const res = await GET(new NextRequest('http://localhost/x'), PARAMS);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      autoAssign: false,
      awayMessage: '',
      businessHours: { enabled: false, timezone: 'Asia/Kolkata' },
    });
  });

  it('rejects someone who is not on the tenant', async () => {
    state.userId = 'stranger';
    expect(
      (await GET(new NextRequest('http://localhost/x'), PARAMS)).status
    ).toBe(403);
  });
});

describe('PUT /api/tenants/[slug]/routing', () => {
  it('saves valid settings', async () => {
    const res = await put({
      businessHours: hours,
      awayMessage: ' Closed now ',
      autoAssign: true,
    });
    expect(res.status).toBe(200);
    expect(state.updates[0]).toMatchObject({
      away_message: 'Closed now',
      auto_assign: true,
      business_hours: { enabled: true, timezone: 'Asia/Kolkata' },
    });
  });

  it('requires an away message when business hours are on', async () => {
    const res = await put({
      businessHours: hours,
      awayMessage: '',
      autoAssign: false,
    });
    expect(res.status).toBe(400);
    expect(state.updates).toEqual([]);
  });

  it('allows an empty away message when hours are off', async () => {
    const res = await put({
      businessHours: { ...hours, enabled: false },
      awayMessage: '',
      autoAssign: true,
    });
    expect(res.status).toBe(200);
    expect(state.updates[0]).toMatchObject({ away_message: null });
  });

  it('rejects a bad timezone, closing before opening, a long message and a non-boolean flag', async () => {
    expect(
      (
        await put({
          businessHours: { ...hours, timezone: 'Mars/Base' },
          awayMessage: 'x',
          autoAssign: false,
        })
      ).status
    ).toBe(400);
    expect(
      (
        await put({
          businessHours: {
            ...hours,
            days: { mon: { open: '18:00', close: '09:00' } },
          },
          awayMessage: 'x',
          autoAssign: false,
        })
      ).status
    ).toBe(400);
    expect(
      (
        await put({
          businessHours: hours,
          awayMessage: 'x'.repeat(1001),
          autoAssign: false,
        })
      ).status
    ).toBe(400);
    expect(
      (await put({ businessHours: hours, awayMessage: 'x', autoAssign: 'yes' }))
        .status
    ).toBe(400);
    expect(state.updates).toEqual([]);
  });

  it('rejects unauthenticated requests', async () => {
    state.userId = null;
    expect(
      (await put({ businessHours: hours, awayMessage: 'x', autoAssign: false }))
        .status
    ).toBe(401);
  });
});
