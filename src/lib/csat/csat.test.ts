import { describe, it, expect } from 'vitest';
import {
  CSAT_RESEND_WINDOW_MS,
  DEFAULT_CSAT_MESSAGE,
  MAX_CSAT_MESSAGE_LENGTH,
  buildCsatList,
  parseCsatReplyId,
  parseCsatSummary,
  pickCsatMessage,
  shouldSendCsat,
} from './csat';

describe('parseCsatReplyId', () => {
  it('reads scores 1-5', () => {
    expect([1, 2, 3, 4, 5].map((n) => parseCsatReplyId(`csat_${n}`))).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });
  it('ignores everything else', () => {
    for (const id of ['csat_0', 'csat_6', 'csat_', 'csat_4x', 'human', '', null, undefined]) {
      expect(parseCsatReplyId(id)).toBeNull();
    }
  });
});

describe('buildCsatList', () => {
  it('has five rows within Meta limits with csat ids', () => {
    const list = buildCsatList(null);
    const rows = list.sections[0].rows;
    expect(rows.map((r) => r.id)).toEqual(['csat_5', 'csat_4', 'csat_3', 'csat_2', 'csat_1']);
    expect(rows.every((r) => [...r.title].length <= 24)).toBe(true);
    expect(list.bodyText).toBe(DEFAULT_CSAT_MESSAGE);
  });
});

describe('pickCsatMessage', () => {
  it('uses custom text trimmed and capped, else default', () => {
    expect(pickCsatMessage('  Rate us ')).toBe('Rate us');
    expect(pickCsatMessage('x'.repeat(900))).toHaveLength(MAX_CSAT_MESSAGE_LENGTH);
    expect(pickCsatMessage('   ')).toBe(DEFAULT_CSAT_MESSAGE);
  });
});

describe('shouldSendCsat', () => {
  const now = new Date('2026-01-02T00:00:00Z');
  it('needs the toggle on', () => {
    expect(shouldSendCsat({ enabled: false, lastRequestedAt: null, now })).toBe(false);
  });
  it('sends when never surveyed', () => {
    expect(shouldSendCsat({ enabled: true, lastRequestedAt: null, now })).toBe(true);
  });
  it('skips inside the resend window, sends after it', () => {
    const recent = new Date(now.getTime() - 1000).toISOString();
    const old = new Date(now.getTime() - CSAT_RESEND_WINDOW_MS).toISOString();
    expect(shouldSendCsat({ enabled: true, lastRequestedAt: recent, now })).toBe(false);
    expect(shouldSendCsat({ enabled: true, lastRequestedAt: old, now })).toBe(true);
  });
});

describe('parseCsatSummary', () => {
  it('parses and defends', () => {
    expect(parseCsatSummary({ responses: 3, average: '4.33' })).toEqual({ responses: 3, average: 4.33 });
    expect(parseCsatSummary({ responses: 0, average: null })).toEqual({ responses: 0, average: null });
    expect(parseCsatSummary(null)).toEqual({ responses: 0, average: null });
  });
});
