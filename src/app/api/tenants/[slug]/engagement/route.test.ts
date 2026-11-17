import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeState {
  userId: string | null;
  row: {
    csat_enabled: boolean;
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

beforeEach(() => {
  state.userId = 'owner1';
  state.row = null;
  state.updates = [];
});

const valid = {
  csatEnabled: true,
  csatMessage: ' Rate us ',
  alertEmail: true,
  alertWhatsapp: true,
  alertNumber: '+91 98765 43210',
};

describe('GET /api/tenants/[slug]/engagement', () => {
  it('returns everything off by default', async () => {
    const res = await GET(new NextRequest('http://localhost/x'), PARAMS);
    expect(await res.json()).toMatchObject({
      csatEnabled: false,
      alertEmail: false,
      alertWhatsapp: false,
    });
  });
  it('rejects a stranger', async () => {
    state.userId = 'stranger';
    expect((await GET(new NextRequest('http://localhost/x'), PARAMS)).status).toBe(403);
  });
});

describe('PUT /api/tenants/[slug]/engagement', () => {
  it('saves valid settings, trimming the message', async () => {
    const res = await put(valid);
    expect(res.status).toBe(200);
    expect(state.updates[0]).toMatchObject({
      csat_enabled: true,
      csat_message: 'Rate us',
      handoff_alert_email: true,
      handoff_alert_whatsapp: true,
      handoff_alert_number: '+91 98765 43210',
    });
  });
  it('requires a usable number when WhatsApp alerts are on', async () => {
    const res = await put({ ...valid, alertNumber: '12' });
    expect(res.status).toBe(400);
    expect(state.updates).toHaveLength(0);
  });
  it('rejects non-boolean toggles and over-long messages', async () => {
    expect((await put({ ...valid, csatEnabled: 'yes' })).status).toBe(400);
    expect((await put({ ...valid, csatMessage: 'x'.repeat(601) })).status).toBe(400);
  });
});
