import { describe, expect, it } from 'vitest';
import {
  MAX_INVITE_BATCH,
  capBatch,
  chunk,
  isWithinServiceWindow,
  planInvites,
  type InviteCandidate,
} from './eligibility';

const NOW = new Date('2026-06-10T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

const c = (id: string, extra: Partial<InviteCandidate> = {}): InviteCandidate => ({
  id,
  phone: `+9100${id}`,
  name: id,
  optInStatus: 'unknown',
  ...extra,
});

const plan = (
  candidates: InviteCandidate[],
  opts: {
    invited?: string[];
    inbound?: Record<string, string>;
    hasTemplate?: boolean;
  } = {}
) =>
  planInvites({
    candidates,
    alreadyInvitedIds: new Set(opts.invited ?? []),
    lastInboundAt: new Map(Object.entries(opts.inbound ?? {})),
    hasTemplate: opts.hasTemplate ?? false,
    now: NOW,
  });

describe('isWithinServiceWindow', () => {
  it('is true under 24h and false at/after 24h, missing or future', () => {
    expect(isWithinServiceWindow(hoursAgo(23.9), NOW)).toBe(true);
    expect(isWithinServiceWindow(hoursAgo(24), NOW)).toBe(false);
    expect(isWithinServiceWindow(null, NOW)).toBe(false);
    expect(isWithinServiceWindow('garbage', NOW)).toBe(false);
    expect(isWithinServiceWindow(hoursAgo(-1), NOW)).toBe(false);
  });
});

describe('planInvites', () => {
  it('skips opted-out contacts even inside the window', () => {
    const r = plan([c('1', { optInStatus: 'opted_out' })], { inbound: { '1': hoursAgo(1) } });
    expect(r.text).toHaveLength(0);
    expect(r.skipped[0].reason).toBe('opted_out');
  });

  it('skips contacts already invited', () => {
    const r = plan([c('1')], { invited: ['1'], inbound: { '1': hoursAgo(1) } });
    expect(r.skipped).toEqual([{ contact: c('1'), reason: 'already_invited' }]);
  });

  it('skips contacts without a phone', () => {
    expect(plan([c('1', { phone: null })]).skipped[0].reason).toBe('no_phone');
  });

  it('sends text inside the window and template outside it', () => {
    const r = plan([c('1'), c('2')], {
      inbound: { '1': hoursAgo(2), '2': hoursAgo(30) },
      hasTemplate: true,
    });
    expect(r.text.map((x) => x.id)).toEqual(['1']);
    expect(r.template.map((x) => x.id)).toEqual(['2']);
  });

  it('skips outside-window contacts when there is no template', () => {
    const r = plan([c('1'), c('2')], { inbound: { '1': hoursAgo(30) } });
    expect(r.skipped.map((s) => s.reason)).toEqual([
      'outside_window_no_template',
      'outside_window_no_template',
    ]);
  });

  it('ignores duplicate candidates', () => {
    const r = plan([c('1'), c('1')], { inbound: { '1': hoursAgo(1) } });
    expect(r.text).toHaveLength(1);
  });
});

describe('batching', () => {
  it('chunks in order', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
    expect(() => chunk([1], 0)).toThrow();
  });

  it('caps a batch and reports the overflow', () => {
    const ids = Array.from({ length: MAX_INVITE_BATCH + 7 }, (_, i) => i);
    const { kept, dropped } = capBatch(ids);
    expect(kept).toHaveLength(MAX_INVITE_BATCH);
    expect(dropped).toBe(7);
    expect(capBatch([1, 2], 5)).toEqual({ kept: [1, 2], dropped: 0 });
  });
});
