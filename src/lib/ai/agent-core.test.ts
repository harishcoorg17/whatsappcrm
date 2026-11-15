import { describe, expect, it } from 'vitest';
import {
  buildSystemPrompt,
  HUMAN_ACTIVE_WINDOW_MS,
  MAX_AI_REPLIES_PER_DAY,
  MAX_REPLY_CHARS,
  parseAgentDecision,
  shouldAnswer,
  toChatMessages,
  type HistoryMessage,
} from './agent-core';

const msg = (
  sender_type: HistoryMessage['sender_type'],
  content_text: string | null
): HistoryMessage => ({
  sender_type,
  content_text,
  created_at: '2026-11-15T10:00:00.000Z',
});

describe('parseAgentDecision', () => {
  it('reads a reply', () => {
    expect(
      parseAgentDecision('{"action":"reply","text":"  Hello there  "}')
    ).toEqual({ type: 'reply', text: 'Hello there' });
  });

  it('reads a handoff with its reason', () => {
    expect(
      parseAgentDecision('{"action":"handoff","reason":"wants a refund"}')
    ).toEqual({ type: 'handoff', reason: 'wants a refund' });
  });

  it('finds the JSON inside code fences or chatter', () => {
    const raw = 'Sure!\n```json\n{"action":"reply","text":"Hi"}\n```';
    expect(parseAgentDecision(raw)).toEqual({ type: 'reply', text: 'Hi' });
  });

  it('hands off instead of sending plain text that is not JSON', () => {
    expect(parseAgentDecision('Your tour costs 5000 rupees').type).toBe(
      'handoff'
    );
  });

  it('hands off on an empty reply, broken JSON or an unknown action', () => {
    expect(parseAgentDecision('{"action":"reply","text":"  "}').type).toBe(
      'handoff'
    );
    expect(parseAgentDecision('{"action":"reply",').type).toBe('handoff');
    expect(parseAgentDecision('{"action":"refund"}').type).toBe('handoff');
    expect(parseAgentDecision('').type).toBe('handoff');
  });

  it('cuts an over-long reply', () => {
    const long = 'a'.repeat(MAX_REPLY_CHARS + 500);
    const decision = parseAgentDecision(
      JSON.stringify({ action: 'reply', text: long })
    );
    expect(decision.type === 'reply' && decision.text.length).toBe(
      MAX_REPLY_CHARS
    );
  });

  it('gives a default reason when a handoff has none', () => {
    const decision = parseAgentDecision('{"action":"handoff"}');
    expect(decision.type === 'handoff' && decision.reason).toBeTruthy();
  });
});

describe('toChatMessages', () => {
  it('maps customers to user and agents/bot to assistant', () => {
    expect(
      toChatMessages([
        msg('customer', 'Hi'),
        msg('bot', 'Hello!'),
        msg('customer', 'Price?'),
      ])
    ).toEqual([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello!' },
      { role: 'user', content: 'Price?' },
    ]);
  });

  it('merges consecutive messages from the same side', () => {
    expect(
      toChatMessages([msg('customer', 'Hi'), msg('customer', 'Anyone there?')])
    ).toEqual([{ role: 'user', content: 'Hi\nAnyone there?' }]);
  });

  it('drops empty messages and a leading assistant turn', () => {
    expect(
      toChatMessages([
        msg('agent', 'Welcome back'),
        msg('customer', null),
        msg('customer', 'Hi'),
      ])
    ).toEqual([{ role: 'user', content: 'Hi' }]);
  });

  it('returns nothing when the customer did not speak last', () => {
    expect(
      toChatMessages([msg('customer', 'Hi'), msg('agent', 'Hey')])
    ).toEqual([]);
  });
});

describe('buildSystemPrompt', () => {
  it('includes the business name, instructions and knowledge', () => {
    const prompt = buildSystemPrompt({
      businessName: 'Acme Tours',
      instructions: 'Be cheerful',
      knowledge: 'Goa trip: 5 days',
    });
    expect(prompt).toContain('Acme Tours');
    expect(prompt).toContain('Be cheerful');
    expect(prompt).toContain('Goa trip: 5 days');
    expect(prompt).toContain('"action":"handoff"');
  });

  it('leaves out empty sections', () => {
    const prompt = buildSystemPrompt({
      businessName: 'Acme',
      instructions: '  ',
      knowledge: null,
    });
    expect(prompt).not.toContain('Business instructions:');
    expect(prompt).not.toContain('Business information:');
  });
});

describe('shouldAnswer', () => {
  const now = new Date('2026-11-15T10:00:00.000Z');
  const base = {
    enabled: true,
    configured: true,
    isText: true,
    conversationStatus: 'open',
    lastAgentMessageAt: null,
    botRepliesLast24h: 0,
    now,
  };

  it('answers an ordinary text message', () => {
    expect(shouldAnswer(base)).toEqual({ answer: true });
  });

  it('stays quiet when off or not configured', () => {
    expect(shouldAnswer({ ...base, enabled: false })).toEqual({
      answer: false,
      reason: 'disabled',
    });
    expect(shouldAnswer({ ...base, configured: false })).toEqual({
      answer: false,
      reason: 'not_configured',
    });
  });

  it('ignores media and other non-text messages', () => {
    expect(shouldAnswer({ ...base, isText: false })).toEqual({
      answer: false,
      reason: 'not_text',
    });
  });

  it('stays quiet once the chat is handed to a human', () => {
    expect(shouldAnswer({ ...base, conversationStatus: 'pending' })).toEqual({
      answer: false,
      reason: 'handed_off',
    });
  });

  it('stays quiet while a human agent is active, then resumes', () => {
    const recent = new Date(now.getTime() - 60_000).toISOString();
    const old = new Date(
      now.getTime() - HUMAN_ACTIVE_WINDOW_MS - 60_000
    ).toISOString();
    expect(shouldAnswer({ ...base, lastAgentMessageAt: recent })).toEqual({
      answer: false,
      reason: 'human_active',
    });
    expect(shouldAnswer({ ...base, lastAgentMessageAt: old })).toEqual({
      answer: true,
    });
  });

  it('stops at the daily cap', () => {
    expect(
      shouldAnswer({ ...base, botRepliesLast24h: MAX_AI_REPLIES_PER_DAY })
    ).toEqual({ answer: false, reason: 'daily_cap' });
  });
});
