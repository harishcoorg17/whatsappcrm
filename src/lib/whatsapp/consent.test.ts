import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendTextMessage = vi.fn();
vi.mock('./meta-api', () => ({
  sendTextMessage: (...args: unknown[]) => sendTextMessage(...args),
}));

import {
  OPT_IN_CONFIRMATION,
  OPT_OUT_CONFIRMATION,
  detectConsentKeyword,
  filterOptedOutRecipients,
  handleConsentKeyword,
  recordConsent,
} from './consent';

interface FakeState {
  status: string | null;
  readError: { message: string } | null;
  updates: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
  optedOutPhones: string[];
  listError: { message: string } | null;
}

const state: FakeState = {
  status: 'unknown',
  readError: null,
  updates: [],
  events: [],
  messages: [],
  optedOutPhones: [],
  listError: null,
};

function chain(table: string) {
  const query: Record<string, unknown> = {};
  let op: 'select' | 'update' = 'select';
  query.select = () => query;
  query.eq = () => query;
  query.update = (values: Record<string, unknown>) => {
    op = 'update';
    state.updates.push(values);
    return query;
  };
  query.insert = async (values: Record<string, unknown>) => {
    (table === 'contact_consent_events' ? state.events : state.messages).push(
      values
    );
    return { error: null };
  };
  query.maybeSingle = async () =>
    state.readError
      ? { data: null, error: state.readError }
      : {
          data: state.status === null ? null : { opt_in_status: state.status },
          error: null,
        };
  query.then = (onFulfilled: (v: unknown) => unknown) =>
    Promise.resolve(
      op === 'update'
        ? { error: null }
        : state.listError
          ? { data: null, error: state.listError }
          : {
              data: state.optedOutPhones.map((phone) => ({ phone })),
              error: null,
            }
    ).then(onFulfilled);
  return query;
}

const db = {
  from: (table: string) => chain(table),
} as unknown as SupabaseClient;

const input = (text: string | null) => ({
  db,
  contactId: 'c1',
  contactPhone: '+919000000001',
  conversationId: 'conv1',
  text,
  accessToken: 'tok',
  phoneNumberId: 'pn1',
});

beforeEach(() => {
  sendTextMessage.mockReset();
  sendTextMessage.mockResolvedValue({ messageId: 'wamid.conf' });
  state.status = 'unknown';
  state.readError = null;
  state.updates = [];
  state.events = [];
  state.messages = [];
  state.optedOutPhones = [];
  state.listError = null;
});

describe('detectConsentKeyword', () => {
  it.each([
    'stop',
    'STOP',
    ' Stop! ',
    'stop all',
    'Unsubscribe',
    'opt out',
    'OPT-OUT',
    'stop.',
  ])('treats %j as opt out', (text) =>
    expect(detectConsentKeyword(text)).toBe('opt_out')
  );

  it.each(['start', 'START', 'Subscribe', 'opt in', 'unstop'])(
    'treats %j as opt in',
    (text) => expect(detectConsentKeyword(text)).toBe('opt_in')
  );

  it.each([
    'please do not stop the delivery',
    'stop calling me at night',
    'bus stop near me?',
    'when does it start',
    'yes',
    '',
    null,
    undefined,
  ])('ignores %j', (text) =>
    expect(detectConsentKeyword(text as string | null)).toBeNull()
  );
});

describe('recordConsent', () => {
  it('updates the contact and logs the change', async () => {
    const changed = await recordConsent(db, {
      contactId: 'c1',
      status: 'opted_out',
      source: 'manual',
      changedBy: 'u1',
      now: new Date('2026-11-15T10:00:00Z'),
    });
    expect(changed).toBe(true);
    expect(state.updates[0]).toMatchObject({
      opt_in_status: 'opted_out',
      consent_source: 'manual',
      opt_out_at: '2026-11-15T10:00:00.000Z',
    });
    expect(state.events[0]).toMatchObject({
      contact_id: 'c1',
      status: 'opted_out',
      source: 'manual',
      changed_by: 'u1',
    });
  });

  it('records opt-in time and does not log when nothing changed', async () => {
    state.status = 'opted_out';
    await recordConsent(db, {
      contactId: 'c1',
      status: 'opted_in',
      source: 'keyword',
    });
    expect(state.updates[0]).toHaveProperty('opt_in_at');
    state.updates = [];
    state.events = [];
    state.status = 'opted_in';
    expect(
      await recordConsent(db, {
        contactId: 'c1',
        status: 'opted_in',
        source: 'keyword',
      })
    ).toBe(false);
    expect(state.updates).toEqual([]);
    expect(state.events).toEqual([]);
  });

  it('does nothing when the consent columns are missing or the contact is unknown', async () => {
    state.readError = { message: 'column does not exist' };
    expect(
      await recordConsent(db, {
        contactId: 'c1',
        status: 'opted_out',
        source: 'x',
      })
    ).toBe(false);
    state.readError = null;
    state.status = null;
    expect(
      await recordConsent(db, {
        contactId: 'c1',
        status: 'opted_out',
        source: 'x',
      })
    ).toBe(false);
  });
});

describe('handleConsentKeyword', () => {
  it('opts the contact out, confirms, and records the confirmation', async () => {
    const result = await handleConsentKeyword(input('STOP'));
    expect(result).toEqual({ handled: true, keyword: 'opt_out' });
    expect(state.updates[0]).toMatchObject({ opt_in_status: 'opted_out' });
    expect(sendTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumberId: 'pn1',
        text: OPT_OUT_CONFIRMATION,
      })
    );
    expect(state.messages[0]).toMatchObject({
      sender_type: 'bot',
      message_id: 'wamid.conf',
      conversation_id: 'conv1',
    });
  });

  it('opts back in on START', async () => {
    state.status = 'opted_out';
    const result = await handleConsentKeyword(input('start'));
    expect(result.keyword).toBe('opt_in');
    expect(state.updates[0]).toMatchObject({ opt_in_status: 'opted_in' });
    expect(sendTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: OPT_IN_CONFIRMATION })
    );
  });

  it('is not handled for ordinary messages', async () => {
    expect(await handleConsentKeyword(input('what are your hours?'))).toEqual({
      handled: false,
      keyword: null,
    });
    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(state.updates).toEqual([]);
  });

  it('still opts out when no number is known, without sending anything', async () => {
    const result = await handleConsentKeyword({
      ...input('stop'),
      phoneNumberId: null,
    });
    expect(result.handled).toBe(true);
    expect(state.updates[0]).toMatchObject({ opt_in_status: 'opted_out' });
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it('never throws when the confirmation fails to send', async () => {
    sendTextMessage.mockRejectedValue(new Error('Meta down'));
    await expect(handleConsentKeyword(input('stop'))).resolves.toEqual({
      handled: true,
      keyword: 'opt_out',
    });
    expect(state.updates[0]).toMatchObject({ opt_in_status: 'opted_out' });
  });
});

describe('filterOptedOutRecipients', () => {
  const recipients = [
    { phone: '+919000000001' },
    { phone: '919000000002' },
    { phone: '+91 90000 00003' },
  ];

  it('removes opted-out numbers whatever format they are written in', async () => {
    state.optedOutPhones = ['9000000001', '+91 90000 00003'];
    const { allowed, skipped } = await filterOptedOutRecipients(
      db,
      'u1',
      recipients
    );
    expect(allowed.map((r) => r.phone)).toEqual(['919000000002']);
    expect(skipped.map((r) => r.phone)).toEqual([
      '+919000000001',
      '+91 90000 00003',
    ]);
  });

  it('keeps everyone when nobody opted out or the columns are missing', async () => {
    expect(
      (await filterOptedOutRecipients(db, 'u1', recipients)).allowed
    ).toHaveLength(3);
    state.listError = { message: 'column does not exist' };
    const result = await filterOptedOutRecipients(db, 'u1', recipients);
    expect(result.allowed).toHaveLength(3);
    expect(result.skipped).toEqual([]);
  });
});
