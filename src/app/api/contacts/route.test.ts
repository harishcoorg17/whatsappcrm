import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeState {
  userId: string | null;
  tenantId: string | null;
  insertError: string | null;
  inserted: Array<Record<string, unknown>>;
}

const state: FakeState = {
  userId: 'u1',
  tenantId: 't1',
  insertError: null,
  inserted: [],
};

function tenantQuery() {
  const query = {
    select: () => query,
    eq: () => query,
    order: () => query,
    limit: () => query,
    maybeSingle: async () => ({
      data: state.tenantId ? { id: state.tenantId } : null,
      error: null,
    }),
  };
  return query;
}

function contactsQuery() {
  const query = {
    insert: (values: Record<string, unknown>) => {
      state.inserted.push(values);
      return query;
    },
    select: () => query,
    single: async () =>
      state.insertError
        ? { data: null, error: { message: state.insertError } }
        : { data: { id: 'c1' }, error: null },
  };
  return query;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: state.userId ? { id: state.userId } : null },
      }),
    },
    from: (table: string) =>
      table === 'crm_tenants' ? tenantQuery() : contactsQuery(),
  }),
}));

async function post(body: Record<string, unknown> | null) {
  const { POST } = await import('./route');
  return POST(
    new NextRequest('http://localhost/api/contacts', {
      method: 'POST',
      body: body === null ? 'not json' : JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  Object.assign(state, {
    userId: 'u1',
    tenantId: 't1',
    insertError: null,
    inserted: [],
  });
});

describe('POST /api/contacts', () => {
  it('rejects a request with no session', async () => {
    state.userId = null;
    expect((await post({ phone: '+911234567890' })).status).toBe(401);
    expect(state.inserted).toHaveLength(0);
  });

  it('rejects an unreadable body', async () => {
    expect((await post(null)).status).toBe(400);
  });

  it('requires a phone number', async () => {
    const res = await post({ name: 'Asha', phone: '   ' });
    expect(res.status).toBe(400);
    expect(state.inserted).toHaveLength(0);
  });

  it('creates the contact owned by the user and filed under their tenant', async () => {
    const res = await post({
      name: ' Asha ',
      phone: ' +911234567890 ',
      email: 'asha@example.com',
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'c1' });
    expect(state.inserted[0]).toEqual({
      user_id: 'u1',
      tenant_id: 't1',
      name: 'Asha',
      phone: '+911234567890',
      email: 'asha@example.com',
    });
  });

  it('still creates the contact when the user owns no tenant', async () => {
    state.tenantId = null;
    const res = await post({ phone: '+911234567890' });
    expect(res.status).toBe(201);
    expect(state.inserted[0]).toMatchObject({ user_id: 'u1', tenant_id: null });
  });

  it('stores blank name and email as null', async () => {
    await post({ name: '  ', phone: '+911234567890', email: '' });
    expect(state.inserted[0]).toMatchObject({ name: null, email: null });
  });

  it('does not send a tags column, which this schema does not have', async () => {
    await post({ phone: '+911234567890' });
    expect('tags' in state.inserted[0]).toBe(false);
  });

  it('reports a database error', async () => {
    state.insertError = 'duplicate key';
    const res = await post({ phone: '+911234567890' });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'duplicate key' });
  });
});
