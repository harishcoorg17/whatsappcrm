import { describe, expect, it } from 'vitest';
import { MAX_LEAD_MS, MIN_LEAD_MS, validateScheduledAt } from './schedule-time';

const now = new Date('2026-06-01T10:00:00.000Z');
const at = (ms: number) => new Date(now.getTime() + ms).toISOString();

describe('validateScheduledAt', () => {
  it('accepts a time far enough ahead and normalises to UTC ISO', () => {
    const r = validateScheduledAt('2026-06-01T14:00:00+02:00', now);
    expect(r).toEqual({ ok: true, scheduledAt: '2026-06-01T12:00:00.000Z' });
  });

  it('rejects empty, non-string and unparsable input', () => {
    expect(validateScheduledAt(undefined, now).ok).toBe(false);
    expect(validateScheduledAt('  ', now).ok).toBe(false);
    expect(validateScheduledAt('not a date', now).ok).toBe(false);
  });

  it('rejects past times and times inside the minimum lead', () => {
    expect(validateScheduledAt(at(-1000), now).ok).toBe(false);
    expect(validateScheduledAt(at(MIN_LEAD_MS - 1), now).ok).toBe(false);
    expect(validateScheduledAt(at(MIN_LEAD_MS), now).ok).toBe(true);
  });

  it('rejects times beyond a year out', () => {
    expect(validateScheduledAt(at(MAX_LEAD_MS + 1000), now).ok).toBe(false);
  });
});
