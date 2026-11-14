import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendText = vi.hoisted(() => vi.fn());
vi.mock('./meta-send', () => ({ engineSendText: sendText }));

import {
  DEFAULT_HANDOFF_MESSAGE,
  DEFAULT_OUT_OF_HOURS_MESSAGE,
  isBotSilenced,
  isHumanRequest,
  isWithinBusinessHours,
  performHandoff,
  pickHandoffMessage,
} from './handoff';

const text = (t: string) => ({ kind: 'text' as const, text: t });

describe('isBotSilenced', () => {
  it('is true only for pending (handed-off) conversations', () => {
    expect(isBotSilenced('pending')).toBe(true);
    expect(isBotSilenced('open')).toBe(false);
    expect(isBotSilenced('closed')).toBe(false);
    expect(isBotSilenced(null)).toBe(false);
  });
});

describe('isHumanRequest', () => {
  it('matches whole-message requests, ignoring case and punctuation', () => {
    expect(isHumanRequest(text('Agent'))).toBe(true);
    expect(isHumanRequest(text('  TALK to a human!! '))).toBe(true);
    expect(isHumanRequest(text('speak to someone.'))).toBe(true);
  });
  it('does not match sentences that merely contain the word', () => {
    expect(isHumanRequest(text('my agent booked this tour'))).toBe(false);
    expect(isHumanRequest(text('hello'))).toBe(false);
    expect(isHumanRequest(text(''))).toBe(false);
  });
  it('matches conventional reply ids', () => {
    expect(
      isHumanRequest({ kind: 'interactive_reply', reply_id: 'talk_to_agent' })
    ).toBe(true);
    expect(isHumanRequest({ kind: 'interactive_reply', reply_id: 'yes' })).toBe(
      false
    );
  });
});

describe('business hours', () => {
  const hours = { start: '09:00', end: '18:00', utc_offset_minutes: 330 };
  it('treats missing hours as always open', () => {
    expect(isWithinBusinessHours(undefined)).toBe(true);
  });
  it('applies the UTC offset', () => {
    // 05:00 UTC = 10:30 IST -> within
    expect(isWithinBusinessHours(hours, new Date('2026-01-05T05:00:00Z'))).toBe(
      true
    );
    // 14:00 UTC = 19:30 IST -> outside
    expect(isWithinBusinessHours(hours, new Date('2026-01-05T14:00:00Z'))).toBe(
      false
    );
  });
  it('supports overnight windows', () => {
    const night = { start: '22:00', end: '06:00', utc_offset_minutes: 0 };
    expect(isWithinBusinessHours(night, new Date('2026-01-05T23:00:00Z'))).toBe(
      true
    );
    expect(isWithinBusinessHours(night, new Date('2026-01-05T12:00:00Z'))).toBe(
      false
    );
  });
});

describe('pickHandoffMessage', () => {
  it('defaults to the generic acknowledgement', () => {
    expect(pickHandoffMessage({})).toBe(DEFAULT_HANDOFF_MESSAGE);
  });
  it('uses a custom message and allows suppressing it with empty string', () => {
    expect(pickHandoffMessage({ message: 'One sec!' })).toBe('One sec!');
    expect(pickHandoffMessage({ message: '' })).toBeNull();
  });
  it('uses the out-of-hours text outside business hours', () => {
    const business_hours = {
      start: '09:00',
      end: '10:00',
      utc_offset_minutes: 0,
    };
    const now = new Date('2026-01-05T20:00:00Z');
    expect(pickHandoffMessage({ business_hours, now })).toBe(
      DEFAULT_OUT_OF_HOURS_MESSAGE
    );
    expect(
      pickHandoffMessage({
        business_hours,
        now,
        out_of_hours_message: 'Closed',
      })
    ).toBe('Closed');
  });
});

function fakeDb() {
  const updates: Array<Record<string, unknown>> = [];
  const db = {
    from: () => ({
      update: (u: Record<string, unknown>) => {
        updates.push(u);
        return { eq: async () => ({ error: null }) };
      },
    }),
  };
  return { db: db as never, updates };
}

describe('performHandoff', () => {
  beforeEach(() => sendText.mockReset());

  it('marks the conversation pending, assigns the agent and acknowledges', async () => {
    const { db, updates } = fakeDb();
    const res = await performHandoff(db, {
      userId: 'u',
      conversationId: 'c',
      contactId: 'k',
      reason: 'handoff_node',
      assignTo: 'agent-1',
    });
    expect(res.ackSent).toBe(true);
    expect(updates[0]).toMatchObject({
      status: 'pending',
      handoff_reason: 'handoff_node',
      assigned_agent_id: 'agent-1',
    });
    expect(updates[0].handoff_at).toBeTruthy();
    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: DEFAULT_HANDOFF_MESSAGE })
    );
  });

  it('still flips status when the acknowledgement fails', async () => {
    sendText.mockReturnValueOnce(Promise.reject(new Error('meta down')));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db, updates } = fakeDb();
    const res = await performHandoff(db, {
      userId: 'u',
      conversationId: 'c',
      contactId: 'k',
      reason: 'customer_requested',
    });
    expect(res.ackSent).toBe(false);
    expect(updates[0]).toMatchObject({ status: 'pending' });
    spy.mockRestore();
  });
});
