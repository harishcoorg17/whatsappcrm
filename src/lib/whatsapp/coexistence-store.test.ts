import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleCoexistenceChange } from './coexistence-store';

type Row = Record<string, unknown>;

interface FakeDb {
  client: SupabaseClient;
  tables: Record<string, Row[]>;
  failInsert: Set<string>;
}

function makeDb(): FakeDb {
  const tables: Record<string, Row[]> = {
    crm_tenants: [
      {
        id: 't1',
        owner_user_id: 'u1',
        phone_number_id: 'p1',
        status: 'active',
      },
    ],
    contacts: [],
    conversations: [],
    messages: [],
  };
  const failInsert = new Set<string>();
  let nextId = 1;

  const from = (table: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    let op: 'select' | 'insert' | 'update' = 'select';
    let payload: Row | Row[] = [];

    const run = async (single: boolean, strict: boolean) => {
      if (op === 'insert') {
        if (failInsert.has(table)) {
          return { data: null, error: { message: 'insert failed' } };
        }
        const rows = (Array.isArray(payload) ? payload : [payload]).map(
          (row) => ({
            id: `${table}-${nextId++}`,
            ...row,
          })
        );
        tables[table] = [...tables[table], ...rows];
        return { data: single ? rows[0] : rows, error: null };
      }
      if (op === 'update') {
        tables[table] = tables[table].map((row) =>
          filters.every((f) => f(row)) ? { ...row, ...(payload as Row) } : row
        );
        return { data: null, error: null };
      }
      const rows = tables[table].filter((row) => filters.every((f) => f(row)));
      if (!single) return { data: rows, error: null };
      if (rows[0]) return { data: rows[0], error: null };
      return strict
        ? { data: null, error: { message: 'no rows' } }
        : { data: null, error: null };
    };

    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value);
        return query;
      },
      in: (column: string, values: unknown[]) => {
        filters.push((row) => values.includes(row[column]));
        return query;
      },
      insert: (rows: Row | Row[]) => {
        op = 'insert';
        payload = rows;
        return query;
      },
      update: (values: Row) => {
        op = 'update';
        payload = values;
        return query;
      },
      maybeSingle: () => run(true, false),
      single: () => run(true, true),
      then: (resolve: (value: unknown) => unknown) =>
        run(false, false).then(resolve),
    };
    return query;
  };

  return { client: { from } as unknown as SupabaseClient, tables, failInsert };
}

const META = { phone_number_id: 'p1' };
const CUSTOMER = '919886444711';

let db: FakeDb;

beforeEach(() => {
  db = makeDb();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

function echo(id: string, to = CUSTOMER, timestamp = '1700000000') {
  return {
    metadata: META,
    message_echoes: [
      { id, to, timestamp, type: 'text', text: { body: `body ${id}` } },
    ],
  };
}

describe('handleCoexistenceChange — routing', () => {
  it('reports a payload with no phone number id', async () => {
    const summary = await handleCoexistenceChange(db.client, {
      field: 'smb_message_echoes',
      value: {},
    });
    expect(summary).toMatchObject({ stored: 0, note: 'no phone number id' });
  });

  it('stores nothing for a number that has no active tenant', async () => {
    const summary = await handleCoexistenceChange(db.client, {
      field: 'smb_message_echoes',
      value: { ...echo('a'), metadata: { phone_number_id: 'unknown' } },
    });
    expect(summary.note).toMatch(/no active tenant/);
    expect(db.tables.messages).toHaveLength(0);
  });

  it('stores nothing for a tenant that has no owner', async () => {
    db.tables.crm_tenants[0].owner_user_id = null;
    const summary = await handleCoexistenceChange(db.client, {
      field: 'smb_message_echoes',
      value: echo('a'),
    });
    expect(summary.note).toMatch(/owner/);
    expect(db.tables.messages).toHaveLength(0);
  });
});

describe('handleCoexistenceChange — phone-app messages', () => {
  it('files an echo as an agent message under a new contact and conversation', async () => {
    const summary = await handleCoexistenceChange(db.client, {
      field: 'smb_message_echoes',
      value: echo('wamid.1'),
    });
    expect(summary).toMatchObject({
      field: 'smb_message_echoes',
      stored: 1,
      skipped: 0,
    });

    expect(db.tables.contacts[0]).toMatchObject({
      user_id: 'u1',
      tenant_id: 't1',
      phone: CUSTOMER,
      name: CUSTOMER,
    });
    expect(db.tables.conversations[0]).toMatchObject({
      user_id: 'u1',
      tenant_id: 't1',
      last_message_text: 'body wamid.1',
      last_message_at: '2023-11-14T22:13:20.000Z',
    });
    expect(db.tables.messages[0]).toMatchObject({
      sender_type: 'agent',
      content_type: 'text',
      content_text: 'body wamid.1',
      message_id: 'wamid.1',
      status: 'sent',
      created_at: '2023-11-14T22:13:20.000Z',
    });
  });

  it('reuses a contact whose number is formatted differently', async () => {
    db.tables.contacts.push({
      id: 'c1',
      user_id: 'u1',
      tenant_id: 't1',
      phone: '+91 98864 44711',
      name: 'Asha',
    });
    await handleCoexistenceChange(db.client, {
      field: 'smb_message_echoes',
      value: echo('wamid.1'),
    });
    expect(db.tables.contacts).toHaveLength(1);
    expect(db.tables.conversations[0].contact_id).toBe('c1');
  });

  it("does not reuse another tenant's contact", async () => {
    db.tables.contacts.push({
      id: 'other',
      user_id: 'u1',
      tenant_id: 't2',
      phone: CUSTOMER,
      name: 'Elsewhere',
    });
    await handleCoexistenceChange(db.client, {
      field: 'smb_message_echoes',
      value: echo('wamid.1'),
    });
    expect(db.tables.contacts).toHaveLength(2);
    expect(db.tables.conversations[0].contact_id).not.toBe('other');
  });

  it('ignores an echo it has already stored', async () => {
    await handleCoexistenceChange(db.client, {
      field: 'smb_message_echoes',
      value: echo('wamid.1'),
    });
    const again = await handleCoexistenceChange(db.client, {
      field: 'smb_message_echoes',
      value: echo('wamid.1'),
    });
    expect(again).toMatchObject({ stored: 0, skipped: 1 });
    expect(db.tables.messages).toHaveLength(1);
  });

  it('counts a failed insert as skipped instead of crashing', async () => {
    db.failInsert.add('messages');
    const summary = await handleCoexistenceChange(db.client, {
      field: 'smb_message_echoes',
      value: echo('wamid.1'),
    });
    expect(summary).toMatchObject({ stored: 0, skipped: 1 });
  });
});

describe('handleCoexistenceChange — history', () => {
  const history = {
    metadata: META,
    history: [
      {
        metadata: { phase: 1, progress: 40 },
        threads: [
          {
            id: CUSTOMER,
            messages: [
              {
                from: CUSTOMER,
                id: 'h1',
                timestamp: '1700000000',
                type: 'text',
                text: { body: 'Hi' },
              },
              {
                from: '918197423336',
                id: 'h2',
                timestamp: '1700000100',
                type: 'text',
                text: { body: 'Hello' },
                history_context: { status: 'read' },
              },
            ],
          },
          {
            id: '919811111111',
            messages: [
              {
                from: '919811111111',
                id: 'h3',
                timestamp: '1700000200',
                type: 'text',
                text: { body: 'Other customer' },
              },
            ],
          },
        ],
      },
    ],
  };

  it('files each thread under its own conversation with the right sender', async () => {
    const summary = await handleCoexistenceChange(db.client, {
      field: 'history',
      value: history,
    });
    expect(summary).toMatchObject({ stored: 3, note: 'progress 40%' });
    expect(db.tables.conversations).toHaveLength(2);
    expect(
      db.tables.messages.map((m) => [m.message_id, m.sender_type, m.status])
    ).toEqual([
      ['h1', 'customer', 'delivered'],
      ['h2', 'agent', 'read'],
      ['h3', 'customer', 'delivered'],
    ]);
  });

  it('does not duplicate history that was already imported', async () => {
    await handleCoexistenceChange(db.client, {
      field: 'history',
      value: history,
    });
    const again = await handleCoexistenceChange(db.client, {
      field: 'history',
      value: history,
    });
    expect(again).toMatchObject({ stored: 0, skipped: 3 });
    expect(db.tables.messages).toHaveLength(3);
  });

  it('keeps a newer last-message preview when older history arrives', async () => {
    db.tables.contacts.push({
      id: 'c1',
      user_id: 'u1',
      tenant_id: 't1',
      phone: CUSTOMER,
      name: 'Asha',
    });
    db.tables.conversations.push({
      id: 'v1',
      user_id: 'u1',
      tenant_id: 't1',
      contact_id: 'c1',
      last_message_text: 'Recent',
      last_message_at: '2030-01-01T00:00:00.000Z',
    });
    await handleCoexistenceChange(db.client, {
      field: 'history',
      value: history,
    });
    const conversation = db.tables.conversations.find((c) => c.id === 'v1');
    expect(conversation).toMatchObject({
      last_message_text: 'Recent',
      last_message_at: '2030-01-01T00:00:00.000Z',
    });
  });

  it('reports the error Meta sends when history sharing is turned off', async () => {
    const summary = await handleCoexistenceChange(db.client, {
      field: 'history',
      value: {
        metadata: META,
        history: [{ errors: [{ code: 2593109, message: 'turned off' }] }],
      },
    });
    expect(summary).toMatchObject({
      stored: 0,
      note: 'history errors: 2593109',
    });
  });
});

describe('handleCoexistenceChange — contacts', () => {
  const sync = (...state_sync: Row[]) => ({ metadata: META, state_sync });

  it('creates a contact from the phone with its name', async () => {
    const summary = await handleCoexistenceChange(db.client, {
      field: 'smb_app_state_sync',
      value: sync({
        type: 'contact',
        contact: { full_name: 'Asha K', phone_number: CUSTOMER },
        action: 'add',
      }),
    });
    expect(summary).toMatchObject({ stored: 1, skipped: 0 });
    expect(db.tables.contacts[0]).toMatchObject({
      name: 'Asha K',
      phone: CUSTOMER,
      tenant_id: 't1',
    });
  });

  it('names a contact that only had its number as a name, but never overwrites a real name', async () => {
    db.tables.contacts.push(
      {
        id: 'a',
        user_id: 'u1',
        tenant_id: 't1',
        phone: CUSTOMER,
        name: CUSTOMER,
      },
      {
        id: 'b',
        user_id: 'u1',
        tenant_id: 't1',
        phone: '919811111111',
        name: 'Ravi',
      }
    );
    await handleCoexistenceChange(db.client, {
      field: 'smb_app_state_sync',
      value: sync(
        {
          type: 'contact',
          contact: { full_name: 'Asha K', phone_number: CUSTOMER },
          action: 'add',
        },
        {
          type: 'contact',
          contact: { full_name: 'Different', phone_number: '919811111111' },
          action: 'add',
        }
      ),
    });
    expect(db.tables.contacts.find((c) => c.id === 'a')?.name).toBe('Asha K');
    expect(db.tables.contacts.find((c) => c.id === 'b')?.name).toBe('Ravi');
  });

  it('keeps a contact the phone removed', async () => {
    db.tables.contacts.push({
      id: 'a',
      user_id: 'u1',
      tenant_id: 't1',
      phone: CUSTOMER,
      name: 'Asha',
    });
    const summary = await handleCoexistenceChange(db.client, {
      field: 'smb_app_state_sync',
      value: sync({
        type: 'contact',
        contact: { phone_number: CUSTOMER },
        action: 'remove',
      }),
    });
    expect(summary).toMatchObject({ stored: 0, skipped: 1 });
    expect(db.tables.contacts).toHaveLength(1);
  });
});
