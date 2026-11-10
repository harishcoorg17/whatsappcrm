import { describe, expect, it } from 'vitest';
import {
  isCoexistenceField,
  parseContactSync,
  parseHistory,
  parseMessageEchoes,
} from './coexistence-events';

describe('isCoexistenceField', () => {
  it('recognises the three coexistence webhook fields', () => {
    expect(isCoexistenceField('smb_message_echoes')).toBe(true);
    expect(isCoexistenceField('history')).toBe(true);
    expect(isCoexistenceField('smb_app_state_sync')).toBe(true);
  });

  it('ignores every other field', () => {
    expect(isCoexistenceField('messages')).toBe(false);
    expect(isCoexistenceField('account_update')).toBe(false);
  });
});

describe('parseMessageEchoes', () => {
  it('turns an echoed text message into an outbound message', () => {
    const result = parseMessageEchoes({
      message_echoes: [
        {
          from: '918197423336',
          to: '919886444711',
          id: 'wamid.1',
          timestamp: '1700000000',
          type: 'text',
          text: { body: 'Hello from the phone app' },
        },
      ],
    });
    expect(result).toEqual([
      {
        messageId: 'wamid.1',
        direction: 'outbound',
        contactPhone: '919886444711',
        contentType: 'text',
        contentText: 'Hello from the phone app',
        status: 'sent',
        createdAt: '2023-11-14T22:13:20.000Z',
      },
    ]);
  });

  it('keeps the caption of a media echo and labels it by type', () => {
    const [image, doc] = parseMessageEchoes({
      message_echoes: [
        { id: 'a', to: '1', type: 'image', image: { caption: 'Beach' } },
        { id: 'b', to: '1', type: 'document', document: {} },
      ],
    });
    expect(image).toMatchObject({ contentType: 'image', contentText: 'Beach' });
    expect(doc).toMatchObject({
      contentType: 'document',
      contentText: '[document]',
    });
  });

  it('stores unsupported types as a readable text placeholder', () => {
    const [sticker] = parseMessageEchoes({
      message_echoes: [{ id: 'a', to: '1', type: 'sticker' }],
    });
    expect(sticker).toMatchObject({
      contentType: 'text',
      contentText: '[sticker message]',
    });
  });

  it('skips entries without an id or recipient, and bad input', () => {
    expect(
      parseMessageEchoes({
        message_echoes: [
          { to: '1', type: 'text' },
          { id: 'x', type: 'text' },
        ],
      })
    ).toEqual([]);
    expect(parseMessageEchoes(null)).toEqual([]);
    expect(parseMessageEchoes({})).toEqual([]);
    expect(parseMessageEchoes('nope')).toEqual([]);
  });

  it('leaves createdAt null when the timestamp is missing or invalid', () => {
    const [a, b] = parseMessageEchoes({
      message_echoes: [
        { id: 'a', to: '1', type: 'text', text: { body: 'x' } },
        {
          id: 'b',
          to: '1',
          type: 'text',
          text: { body: 'x' },
          timestamp: 'abc',
        },
      ],
    });
    expect(a.createdAt).toBeNull();
    expect(b.createdAt).toBeNull();
  });
});

describe('parseHistory', () => {
  const customer = '919886444711';
  const business = '918197423336';

  const payload = {
    history: [
      {
        metadata: { phase: 1, chunk_order: 2, progress: 55 },
        threads: [
          {
            id: customer,
            messages: [
              {
                from: customer,
                to: business,
                id: 'in1',
                timestamp: '1700000000',
                type: 'text',
                text: { body: 'Hi' },
                history_context: { status: 'read' },
              },
              {
                from: business,
                to: customer,
                id: 'out1',
                timestamp: '1700000060',
                type: 'text',
                text: { body: 'Hello' },
                history_context: { status: 'delivered' },
              },
              {
                from: business,
                to: customer,
                id: 'out2',
                timestamp: '1700000120',
                type: 'media_placeholder',
                history_context: { status: 'error' },
              },
            ],
          },
        ],
      },
    ],
  };

  it('reads each thread message with its direction and status', () => {
    const { messages } = parseHistory(payload);
    expect(messages.map((m) => [m.messageId, m.direction, m.status])).toEqual([
      ['in1', 'inbound', 'delivered'],
      ['out1', 'outbound', 'delivered'],
      ['out2', 'outbound', 'failed'],
    ]);
    expect(messages.every((m) => m.contactPhone === customer)).toBe(true);
  });

  it('labels media that history does not carry', () => {
    const { messages } = parseHistory(payload);
    expect(messages[2]).toMatchObject({
      contentType: 'text',
      contentText: '[Media not included in synced history]',
    });
  });

  it('reports progress and phase', () => {
    expect(parseHistory(payload)).toMatchObject({ progress: 55, phase: 1 });
  });

  it('matches the customer even when the number is formatted differently', () => {
    const { messages } = parseHistory({
      history: [
        {
          threads: [
            {
              id: '+91 98864 44711',
              messages: [
                {
                  from: '919886444711',
                  id: 'a',
                  timestamp: '1700000000',
                  type: 'text',
                  text: { body: 'x' },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(messages[0].direction).toBe('inbound');
  });

  it('maps the remaining Meta statuses onto the ones the database allows', () => {
    const statuses = ['pending', 'played', 'sent'].map(
      (status) =>
        parseHistory({
          history: [
            {
              threads: [
                {
                  id: customer,
                  messages: [
                    {
                      from: business,
                      id: status,
                      type: 'text',
                      text: { body: 'x' },
                      history_context: { status },
                    },
                  ],
                },
              ],
            },
          ],
        }).messages[0].status
    );
    expect(statuses).toEqual(['sending', 'read', 'sent']);
  });

  it('surfaces the error Meta sends when history sharing is off', () => {
    const result = parseHistory({
      history: [
        {
          errors: [
            {
              code: 2593109,
              title: 'History sync is turned off by the business',
              message: 'History sync is turned off by the business',
            },
          ],
        },
      ],
    });
    expect(result.messages).toEqual([]);
    expect(result.errors).toEqual([
      { code: 2593109, message: 'History sync is turned off by the business' },
    ]);
  });

  it('handles empty or malformed input', () => {
    expect(parseHistory(null)).toEqual({
      messages: [],
      progress: null,
      phase: null,
      errors: [],
    });
    expect(parseHistory({ history: 'x' }).messages).toEqual([]);
  });
});

describe('parseContactSync', () => {
  it('reads added contacts with their best name', () => {
    expect(
      parseContactSync({
        state_sync: [
          {
            type: 'contact',
            contact: {
              full_name: 'Asha K',
              first_name: 'Asha',
              phone_number: '919886444711',
            },
            action: 'add',
          },
          {
            type: 'contact',
            contact: { first_name: 'Ravi', phone_number: '919811111111' },
            action: 'add',
          },
        ],
      })
    ).toEqual([
      { action: 'add', phone: '919886444711', name: 'Asha K' },
      { action: 'add', phone: '919811111111', name: 'Ravi' },
    ]);
  });

  it('reads removals, which carry no name', () => {
    expect(
      parseContactSync({
        state_sync: [
          {
            type: 'contact',
            contact: { phone_number: '919886444711' },
            action: 'remove',
          },
        ],
      })
    ).toEqual([{ action: 'remove', phone: '919886444711', name: null }]);
  });

  it('skips non-contact entries and contacts without a phone number', () => {
    expect(
      parseContactSync({
        state_sync: [
          { type: 'other', contact: { phone_number: '1' }, action: 'add' },
          {
            type: 'contact',
            contact: { full_name: 'No Phone' },
            action: 'add',
          },
        ],
      })
    ).toEqual([]);
    expect(parseContactSync(undefined)).toEqual([]);
  });
});
