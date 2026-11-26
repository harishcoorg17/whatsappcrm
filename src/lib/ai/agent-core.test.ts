import { describe, expect, it } from 'vitest';
import {
  buildSystemPrompt,
  HUMAN_ACTIVE_WINDOW_MS,
  isLeadQualified,
  MAX_AI_REPLIES_PER_DAY,
  MAX_LEAD_VALUE_CHARS,
  MAX_REPLY_CHARS,
  parseAgentDecision,
  parsePartnerType,
  parseLead,
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

  it('for outreach chats forbids asking about trips and drops lead capture', () => {
    const outreach = buildSystemPrompt({
      businessName: 'Amstago',
      instructions: null,
      knowledge: null,
      leadCapture: true,
      outreach: true,
    });
    expect(outreach).toContain('business outreach');
    expect(outreach).toContain('Never ask which tour');
    expect(outreach).not.toContain('"lead":{');

    const ordinary = buildSystemPrompt({
      businessName: 'Amstago',
      instructions: null,
      knowledge: null,
      leadCapture: true,
    });
    expect(ordinary).not.toContain('business outreach');
    expect(ordinary).toContain('"lead":{');
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

  it('answers again right after the chat is handed back to the bot', () => {
    const agentAt = new Date(now.getTime() - 5 * 60_000).toISOString();
    const resumedAfter = new Date(now.getTime() - 60_000).toISOString();
    expect(
      shouldAnswer({
        ...base,
        lastAgentMessageAt: agentAt,
        aiResumedAt: resumedAfter,
      })
    ).toEqual({ answer: true });
  });

  it('still pauses for a human who replied after the hand-back', () => {
    const resumedAt = new Date(now.getTime() - 10 * 60_000).toISOString();
    const agentAfter = new Date(now.getTime() - 60_000).toISOString();
    expect(
      shouldAnswer({
        ...base,
        lastAgentMessageAt: agentAfter,
        aiResumedAt: resumedAt,
      })
    ).toEqual({ answer: false, reason: 'human_active' });
  });

  it('treats an unreadable resume time as never resumed', () => {
    const agentAt = new Date(now.getTime() - 60_000).toISOString();
    expect(
      shouldAnswer({
        ...base,
        lastAgentMessageAt: agentAt,
        aiResumedAt: 'not-a-date',
      })
    ).toEqual({ answer: false, reason: 'human_active' });
  });

  it('stops at the daily cap', () => {
    expect(
      shouldAnswer({ ...base, botRepliesLast24h: MAX_AI_REPLIES_PER_DAY })
    ).toEqual({ answer: false, reason: 'daily_cap' });
  });
});

describe('parseLead', () => {
  it('keeps known fields as trimmed text, including numbers', () => {
    expect(
      parseLead({
        destination: '  Goa ',
        travel_dates: 'last week of December',
        group_size: 4,
        budget: '50k per person',
        favourite_colour: 'blue',
      })
    ).toEqual({
      destination: 'Goa',
      travel_dates: 'last week of December',
      group_size: '4',
      budget: '50k per person',
    });
  });

  it('drops empty, oversized-type and non-object values', () => {
    expect(parseLead({ destination: '   ', budget: { amount: 1 } })).toBe(
      undefined
    );
    expect(parseLead(null)).toBe(undefined);
    expect(parseLead(['Goa'])).toBe(undefined);
    expect(parseLead('Goa')).toBe(undefined);
  });

  it('caps long values', () => {
    const lead = parseLead({ destination: 'x'.repeat(500) });
    expect(lead?.destination).toHaveLength(MAX_LEAD_VALUE_CHARS);
  });
});

describe('isLeadQualified', () => {
  it('needs a destination plus one more detail', () => {
    expect(isLeadQualified({ destination: 'Goa' })).toBe(false);
    expect(isLeadQualified({ budget: '50k', group_size: '4' })).toBe(false);
    expect(isLeadQualified({ destination: 'Goa', group_size: '4' })).toBe(true);
    expect(isLeadQualified({ destination: 'Goa', travel_dates: 'Dec' })).toBe(
      true
    );
  });
});

describe('parseAgentDecision lead details', () => {
  it('carries the lead on a reply and on a handoff', () => {
    expect(
      parseAgentDecision(
        '{"action":"reply","text":"Great!","lead":{"destination":"Goa"}}'
      )
    ).toEqual({ type: 'reply', text: 'Great!', lead: { destination: 'Goa' } });
    expect(
      parseAgentDecision(
        '{"action":"handoff","reason":"wants a call","lead":{"budget":"1L"}}'
      )
    ).toEqual({
      type: 'handoff',
      reason: 'wants a call',
      lead: { budget: '1L' },
    });
  });

  it('ignores a malformed lead without losing the reply', () => {
    expect(
      parseAgentDecision('{"action":"reply","text":"Hi","lead":"Goa"}')
    ).toEqual({ type: 'reply', text: 'Hi' });
  });
});

describe('buildSystemPrompt lead capture', () => {
  const base = { businessName: 'Amstago', instructions: null, knowledge: null };

  it('asks for trip details only when lead capture is on', () => {
    expect(buildSystemPrompt({ ...base, leadCapture: true })).toContain(
      '"lead"'
    );
    expect(buildSystemPrompt(base)).not.toContain('"lead"');
  });
});

describe('partner detection', () => {
  const base = { businessName: 'Amstago', instructions: null, knowledge: null };

  it('reads which kind of partner the model saw', () => {
    expect(
      parseAgentDecision(
        '{"action":"reply","text":"Thanks, we will review.","sender":"hotel"}'
      )
    ).toEqual({ type: 'reply', text: 'Thanks, we will review.', partner: 'hotel' });
    expect(
      parseAgentDecision('{"action":"handoff","reason":"rate query","sender":"DMC"}')
    ).toEqual({ type: 'handoff', reason: 'rate query', partner: 'dmc' });
  });

  it('treats "customer", unknown or missing senders as no partner', () => {
    for (const sender of ['customer', 'alien', 5, undefined]) {
      const decision = parseAgentDecision(
        JSON.stringify({ action: 'reply', text: 'Hi', sender })
      );
      expect(decision).toEqual({ type: 'reply', text: 'Hi' });
    }
    expect(parsePartnerType(' Transport ')).toBe('transport');
    expect(parsePartnerType('customer')).toBeUndefined();
  });

  it('drops trip details when the sender is a partner', () => {
    const decision = parseAgentDecision(
      '{"action":"reply","text":"Noted","sender":"dmc","lead":{"destination":"Goa"}}'
    );
    expect(decision).toEqual({ type: 'reply', text: 'Noted', partner: 'dmc' });
  });

  it('keeps trip details for customers', () => {
    const decision = parseAgentDecision(
      '{"action":"reply","text":"Nice","sender":"customer","lead":{"destination":"Goa"}}'
    );
    expect(decision).toEqual({
      type: 'reply',
      text: 'Nice',
      lead: { destination: 'Goa' },
    });
  });

  it('tells the model partners exist and asks for the sender in the answer', () => {
    const prompt = buildSystemPrompt(base);
    expect(prompt).toContain('DMCs (ground tour operators), hotels');
    expect(prompt).toContain('"sender"');
    expect(prompt).toContain('Never accept, reject, negotiate or confirm');
    expect(prompt).toContain('If it is not clear, treat the person as a customer.');
  });

  it('states a known partner type instead of guessing', () => {
    const prompt = buildSystemPrompt({ ...base, knownPartner: 'hotel' });
    expect(prompt).toContain('already identified as a hotel');
    expect(prompt).not.toContain('If it is not clear, treat the person as a customer.');
  });

  it('keeps trip-detail capture out of partner chats', () => {
    const prompt = buildSystemPrompt({ ...base, leadCapture: true });
    expect(prompt).toContain('customers only, never for partners');
  });
});
