import { describe, expect, it } from 'vitest';
import {
  chartMax,
  clampSlaMinutes,
  formatMinutes,
  formatPercent,
  parseAdSources,
  parseOverview,
  ratePercent,
} from './analytics';

// The shape analytics_overview returns (verified against Postgres 16).
const SAMPLE = {
  days: 7,
  slaMinutes: 15,
  conversations: 1,
  inboundMessages: 2,
  outboundMessages: 2,
  respondedConversations: 1,
  unansweredConversations: 0,
  avgFirstResponseMinutes: 10.0,
  medianFirstResponseMinutes: 10.0,
  slaMetPercent: 100.0,
  waitingBreaches: 1,
  waitingNow: [{ conversationId: 'c1', waitingMinutes: 20 }],
  daily: [
    { day: '2026-11-15', inbound: 2, outbound: 2 },
    { day: '2026-11-14', inbound: 0, outbound: 0 },
  ],
  agents: [
    { agentId: 'a1', assigned: 1, closed: 0, avgFirstResponseMinutes: 10.0 },
  ],
};

describe('parseOverview', () => {
  it('parses the database JSON', () => {
    expect(parseOverview(SAMPLE)).toEqual(SAMPLE);
  });

  it('returns null for anything that is not an object', () => {
    expect(parseOverview(null)).toBeNull();
    expect(parseOverview('oops')).toBeNull();
  });

  it('never produces NaN and keeps null for missing averages', () => {
    const parsed = parseOverview({
      conversations: 'abc',
      avgFirstResponseMinutes: null,
      slaMetPercent: null,
      daily: [{ day: '2026-11-15', inbound: 'x' }],
      waitingNow: 'nope',
      agents: [null, { agentId: 'a' }],
    });
    expect(parsed?.conversations).toBe(0);
    expect(parsed?.avgFirstResponseMinutes).toBeNull();
    expect(parsed?.slaMetPercent).toBeNull();
    expect(parsed?.daily[0]).toEqual({
      day: '2026-11-15',
      inbound: 0,
      outbound: 0,
    });
    expect(parsed?.waitingNow).toEqual([]);
    expect(parsed?.agents).toHaveLength(1);
    expect(parsed?.days).toBe(7);
  });
});

describe('formatMinutes', () => {
  it('shows a dash when there is no data', () => {
    expect(formatMinutes(null)).toBe('–');
    expect(formatMinutes(undefined)).toBe('–');
    expect(formatMinutes(Number.NaN)).toBe('–');
  });

  it('uses seconds, minutes, hours and days', () => {
    expect(formatMinutes(0.5)).toBe('30s');
    expect(formatMinutes(0.001)).toBe('1s');
    expect(formatMinutes(12.4)).toBe('12 min');
    expect(formatMinutes(125)).toBe('2h 5m');
    expect(formatMinutes(120)).toBe('2h');
    expect(formatMinutes(60 * 28)).toBe('1d 4h');
    expect(formatMinutes(60 * 48)).toBe('2d');
  });
});

describe('formatPercent / chartMax / clampSlaMinutes', () => {
  it('formats percentages', () => {
    expect(formatPercent(87.4)).toBe('87%');
    expect(formatPercent(null)).toBe('–');
  });

  it('keeps the chart scale above zero', () => {
    expect(chartMax([])).toBe(1);
    expect(chartMax([{ day: 'd', inbound: 0, outbound: 0 }])).toBe(1);
    expect(chartMax([{ day: 'd', inbound: 3, outbound: 9 }])).toBe(9);
  });

  it('clamps the SLA to what the database accepts', () => {
    expect(clampSlaMinutes(0)).toBe(1);
    expect(clampSlaMinutes(99999)).toBe(1440);
    expect(clampSlaMinutes(12.6)).toBe(13);
    expect(clampSlaMinutes(Number.NaN)).toBe(15);
  });
});

describe('parseAdSources', () => {
  it('parses, drops rows without an id and sorts by chats', () => {
    const rows = parseAdSources([
      { sourceId: 'b', chats: 1, replies: 1, deals: 0, wonDeals: 0 },
      { sourceId: '', chats: 99 },
      { sourceId: 'a', headline: 'Goa', chats: '5', replies: 3, deals: 2, wonDeals: 1 },
    ]);
    expect(rows.map((r) => r.sourceId)).toEqual(['a', 'b']);
    expect(rows[0]).toMatchObject({ headline: 'Goa', chats: 5, wonDeals: 1 });
  });
  it('returns [] for junk', () => {
    expect(parseAdSources(null)).toEqual([]);
    expect(parseAdSources({})).toEqual([]);
  });
});

describe('ratePercent', () => {
  it('is null with no chats and rounds otherwise', () => {
    expect(ratePercent(0, 0)).toBeNull();
    expect(ratePercent(1, 3)).toBe(33);
  });
});
