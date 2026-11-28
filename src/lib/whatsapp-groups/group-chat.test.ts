import { beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  describeGroupSender,
  groupContactPhone,
  groupContentType,
  isGroupContactPhone,
  recordGroupMessage,
  type GroupMessageInput,
} from './group-chat';

type Row = Record<string, unknown>;

/** A tiny in-memory stand-in for the parts of the Supabase client the module uses. */
function fakeDb(tables: Record<string, Row[]>) {
  let nextId = 1;
  const from = (name: string) => {
    const rows = (tables[name] ??= []);
    const filters: Array<(r: Row) => boolean> = [];
    let op: 'select' | 'insert' | 'update' = 'select';
    let payload: Row = {};
    let limit = Infinity;
    const matching = () =>
      rows.filter((r) => filters.every((f) => f(r))).slice(0, limit);
    const run = () => {
      if (op === 'insert') {
        const row = { id: `id-${nextId++}`, unread_count: 0, ...payload };
        rows.push(row);
        return [row];
      }
      if (op === 'update') {
        const hit = matching();
        hit.forEach((r) => Object.assign(r, payload));
        return hit;
      }
      return matching();
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      insert: (p: Row) => {
        op = 'insert';
        payload = p;
        return builder;
      },
      update: (p: Row) => {
        op = 'update';
        payload = p;
        return builder;
      },
      eq: (col: string, value: unknown) => {
        filters.push((r) => r[col] === value);
        return builder;
      },
      limit: (n: number) => {
        limit = n;
        return builder;
      },
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      single: async () => {
        const row = run()[0];
        return row
          ? { data: row, error: null }
          : { data: null, error: { message: 'no row' } };
      },
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: run(), error: null }).then(resolve),
    };
    return builder;
  };
  return { from } as unknown as SupabaseClient;
}

const input = (over: Partial<GroupMessageInput> = {}): GroupMessageInput => ({
  tenantId: 't1',
  ownerUserId: 'owner-1',
  waGroupId: 'GRP123',
  messageId: 'wamid.1',
  sender: { name: 'Asha', waId: '919886444711' },
  content: { text: 'Hello everyone', mediaUrl: null, mediaType: 'text' },
  ...over,
});

describe('helpers', () => {
  it('marks group contacts by their phone prefix', () => {
    expect(groupContactPhone('GRP123')).toBe('group:GRP123');
    expect(isGroupContactPhone('group:GRP123')).toBe(true);
    expect(isGroupContactPhone('+919886444711')).toBe(false);
    expect(isGroupContactPhone(null)).toBe(false);
  });

  it('names the sender by name, then number, then a generic label', () => {
    expect(describeGroupSender({ name: ' Asha ', waId: '1' })).toBe('Asha');
    expect(describeGroupSender({ name: '', waId: '91 98864 44711' })).toBe(
      '+919886444711'
    );
    expect(describeGroupSender({})).toBe('Participant');
  });

  it('keeps types the inbox can show and turns the rest into text', () => {
    expect(groupContentType('image')).toBe('image');
    expect(groupContentType('document')).toBe('document');
    expect(groupContentType('sticker')).toBe('text');
    expect(groupContentType(null)).toBe('text');
  });
});

describe('recordGroupMessage', () => {
  let tables: Record<string, Row[]>;
  beforeEach(() => {
    tables = {
      whatsapp_groups: [
        {
          id: 'g1',
          tenant_id: 't1',
          wa_group_id: 'GRP123',
          name: 'Amstago: Kerala - 5 Dec 2026',
        },
      ],
      contacts: [],
      conversations: [],
      messages: [],
    };
  });

  it('files the first message under a new group contact and conversation, naming the sender', async () => {
    const db = fakeDb(tables);
    expect(await recordGroupMessage(db, input())).toBe('stored');

    expect(tables.contacts).toEqual([
      expect.objectContaining({
        phone: 'group:GRP123',
        name: 'Amstago: Kerala - 5 Dec 2026',
        tenant_id: 't1',
      }),
    ]);
    expect(tables.conversations).toEqual([
      expect.objectContaining({
        wa_group_id: 'GRP123',
        tenant_id: 't1',
        last_message_text: 'Asha: Hello everyone',
        unread_count: 1,
      }),
    ]);
    expect(tables.messages).toEqual([
      expect.objectContaining({
        sender_type: 'customer',
        sender_name: 'Asha',
        sender_wa_id: '919886444711',
        content_text: 'Hello everyone',
        message_id: 'wamid.1',
      }),
    ]);
  });

  it('adds later messages to the same conversation and counts unread', async () => {
    const db = fakeDb(tables);
    await recordGroupMessage(db, input());
    await recordGroupMessage(
      db,
      input({
        messageId: 'wamid.2',
        sender: { name: 'Ravi', waId: '919000011111' },
        content: { text: 'Hi Asha', mediaUrl: null, mediaType: 'text' },
      })
    );

    expect(tables.contacts).toHaveLength(1);
    expect(tables.conversations).toHaveLength(1);
    expect(tables.messages).toHaveLength(2);
    expect(tables.conversations[0]).toMatchObject({
      unread_count: 2,
      last_message_text: 'Ravi: Hi Asha',
    });
  });

  it('ignores a message Meta delivers twice', async () => {
    const db = fakeDb(tables);
    await recordGroupMessage(db, input());
    expect(await recordGroupMessage(db, input())).toBe('duplicate');
    expect(tables.messages).toHaveLength(1);
  });

  it('ignores a group that is not one of ours, creating nothing', async () => {
    const db = fakeDb(tables);
    expect(await recordGroupMessage(db, input({ waGroupId: 'OTHER' }))).toBe(
      'unknown_group'
    );
    expect(tables.contacts).toHaveLength(0);
    expect(tables.messages).toHaveLength(0);
  });

  it('stores media with its link, and a placeholder for content it cannot show', async () => {
    const db = fakeDb(tables);
    await recordGroupMessage(
      db,
      input({
        content: {
          text: null,
          mediaUrl: 'https://cdn.example/p.jpg',
          mediaType: 'image',
        },
      })
    );
    await recordGroupMessage(
      db,
      input({
        messageId: 'wamid.3',
        content: { text: null, mediaUrl: null, mediaType: null },
      })
    );
    expect(tables.messages[0]).toMatchObject({
      content_type: 'image',
      media_url: 'https://cdn.example/p.jpg',
      content_text: null,
    });
    expect(tables.messages[1]).toMatchObject({
      content_type: 'text',
      content_text: '[Message not shown]',
    });
  });

  it('renames the group contact when the group is renamed', async () => {
    const db = fakeDb(tables);
    await recordGroupMessage(db, input());
    tables.whatsapp_groups[0].name = 'Amstago: Kerala - 6 Dec 2026';
    await recordGroupMessage(db, input({ messageId: 'wamid.9' }));
    expect(tables.contacts[0].name).toBe('Amstago: Kerala - 6 Dec 2026');
  });
});
