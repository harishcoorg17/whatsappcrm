import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it } from 'vitest';
import { recordOutboundTemplate } from './record-outbound';

interface Row {
  [key: string]: unknown;
}

const state: {
  contacts: Row[];
  conversations: Row[];
  messages: Row[];
  conversationUpdates: Row[];
  messageError: string | null;
  nextId: number;
} = {
  contacts: [],
  conversations: [],
  messages: [],
  conversationUpdates: [],
  messageError: null,
  nextId: 1,
};

function newId(prefix: string): string {
  return `${prefix}-${state.nextId++}`;
}

function fakeDb() {
  return {
    from: (table: string) => {
      const filters: Array<[string, unknown]> = [];
      const matches = (row: Row) =>
        filters.every(([column, value]) => row[column] === value);
      const rows = () =>
        (table === 'contacts' ? state.contacts : state.conversations).filter(
          matches
        );

      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return query;
        },
        // A list read: `await db.from('contacts').select().eq().eq()`
        then: (resolve: (value: unknown) => void) =>
          resolve({ data: rows(), error: null }),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        insert: (values: Row) => {
          if (table === 'messages') {
            if (state.messageError) {
              return Promise.resolve({
                error: { message: state.messageError },
              });
            }
            state.messages.push(values);
            return Promise.resolve({ error: null });
          }
          const row = { id: newId(table), ...values };
          (table === 'contacts' ? state.contacts : state.conversations).push(
            row
          );
          return {
            select: () => ({
              single: async () => ({ data: row, error: null }),
            }),
          };
        },
        update: (values: Row) => ({
          eq: async (_column: string, id: string) => {
            state.conversationUpdates.push({ id, ...values });
            return { error: null };
          },
        }),
      };
      return query;
    },
  } as unknown as SupabaseClient;
}

const ARGS = {
  tenantId: 't1',
  ownerUserId: 'u1',
  phone: '919876543210',
  contactName: 'Asha Rao',
  templateName: 'tour_purchase_confirmation',
  bodyText: 'Hi Asha, your Kerala trip is confirmed.',
  messageId: 'wamid.1',
};

beforeEach(() => {
  state.contacts = [];
  state.conversations = [];
  state.messages = [];
  state.conversationUpdates = [];
  state.messageError = null;
  state.nextId = 1;
});

describe('recordOutboundTemplate', () => {
  it('creates the contact and conversation for a new customer and saves the message', async () => {
    const { conversationId } = await recordOutboundTemplate(fakeDb(), ARGS);

    expect(state.contacts).toHaveLength(1);
    expect(state.contacts[0]).toMatchObject({
      user_id: 'u1',
      tenant_id: 't1',
      phone: '919876543210',
      name: 'Asha Rao',
    });
    expect(state.conversations[0]).toMatchObject({
      user_id: 'u1',
      tenant_id: 't1',
      contact_id: state.contacts[0].id,
    });
    expect(conversationId).toBe(state.conversations[0].id);
    expect(state.messages[0]).toMatchObject({
      conversation_id: conversationId,
      sender_type: 'bot',
      content_type: 'template',
      content_text: ARGS.bodyText,
      template_name: 'tour_purchase_confirmation',
      message_id: 'wamid.1',
      status: 'sent',
    });
  });

  it('names a contact after its phone number when no name is given', async () => {
    await recordOutboundTemplate(fakeDb(), { ...ARGS, contactName: undefined });
    expect(state.contacts[0].name).toBe('919876543210');
  });

  it('reuses an existing contact even if the number is formatted differently', async () => {
    state.contacts = [
      {
        id: 'c-existing',
        user_id: 'u1',
        tenant_id: 't1',
        phone: '+91 98765 43210',
        name: 'Asha',
      },
    ];
    await recordOutboundTemplate(fakeDb(), ARGS);
    expect(state.contacts).toHaveLength(1);
    expect(state.conversations[0].contact_id).toBe('c-existing');
  });

  it("does not reuse another tenant's contact", async () => {
    state.contacts = [
      {
        id: 'c-other',
        user_id: 'u1',
        tenant_id: 'other-tenant',
        phone: '919876543210',
        name: 'Asha',
      },
    ];
    await recordOutboundTemplate(fakeDb(), ARGS);
    expect(state.contacts).toHaveLength(2);
  });

  it('reuses the existing conversation and updates its preview', async () => {
    state.contacts = [
      { id: 'c1', user_id: 'u1', tenant_id: 't1', phone: '919876543210' },
    ];
    state.conversations = [
      { id: 'conv1', user_id: 'u1', tenant_id: 't1', contact_id: 'c1' },
    ];
    const { conversationId } = await recordOutboundTemplate(fakeDb(), ARGS);

    expect(conversationId).toBe('conv1');
    expect(state.conversations).toHaveLength(1);
    expect(state.conversationUpdates[0]).toMatchObject({
      id: 'conv1',
      last_message_text: ARGS.bodyText,
    });
    expect(state.conversationUpdates[0]).toHaveProperty('last_message_at');
  });

  it('fails loudly when the message cannot be saved', async () => {
    state.messageError = 'insert failed';
    await expect(recordOutboundTemplate(fakeDb(), ARGS)).rejects.toThrow(
      /insert failed/
    );
  });
});
