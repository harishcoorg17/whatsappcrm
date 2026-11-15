import { describe, expect, it } from 'vitest';
import {
  AWAY_MESSAGE_COOLDOWN_MS,
  defaultBusinessHours,
  isWithinBusinessHours,
  parseBusinessHours,
  pickLeastLoadedAgent,
  shouldSendAwayMessage,
  type BusinessHours,
} from './business-hours';

// 2026-11-16 is a Monday. India is UTC+5:30, so 04:00Z = 09:30 in Kolkata.
const MON_0930_IST = new Date('2026-11-16T04:00:00Z');
const MON_1800_IST = new Date('2026-11-16T12:30:00Z');
const MON_2100_IST = new Date('2026-11-16T15:30:00Z');
const SAT_1100_IST = new Date('2026-11-21T05:30:00Z');

const open = (over: Partial<BusinessHours> = {}): BusinessHours => ({
  ...defaultBusinessHours(),
  enabled: true,
  ...over,
});

describe('isWithinBusinessHours', () => {
  it('treats disabled hours as always open', () => {
    expect(isWithinBusinessHours(MON_2100_IST, defaultBusinessHours())).toBe(
      true
    );
  });

  it('is open during the day and closed after hours', () => {
    expect(isWithinBusinessHours(MON_0930_IST, open())).toBe(true);
    expect(isWithinBusinessHours(MON_2100_IST, open())).toBe(false);
  });

  it('closes exactly at the closing time', () => {
    expect(isWithinBusinessHours(MON_1800_IST, open())).toBe(false);
  });

  it('is closed on a day with no hours', () => {
    expect(isWithinBusinessHours(SAT_1100_IST, open())).toBe(false);
  });

  it('uses the tenant timezone, not the server one', () => {
    // 04:00Z is 09:30 in Kolkata but 23:00 the day before in New York.
    expect(
      isWithinBusinessHours(
        MON_0930_IST,
        open({ timezone: 'America/New_York' })
      )
    ).toBe(false);
  });
});

describe('parseBusinessHours', () => {
  const valid = {
    enabled: true,
    timezone: 'Asia/Kolkata',
    days: { mon: { open: '09:00', close: '17:30' }, sun: null },
  };

  it('accepts valid hours and closes days that are missing', () => {
    const result = parseBusinessHours(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.hours.days.mon).toEqual({ open: '09:00', close: '17:30' });
      expect(result.hours.days.tue).toBeNull();
    }
  });

  it('rejects a bad timezone, bad time and closing before opening', () => {
    expect(parseBusinessHours({ ...valid, timezone: 'Mars/Base' }).ok).toBe(
      false
    );
    expect(
      parseBusinessHours({
        ...valid,
        days: { mon: { open: '9am', close: '5pm' } },
      }).ok
    ).toBe(false);
    expect(
      parseBusinessHours({
        ...valid,
        days: { mon: { open: '18:00', close: '09:00' } },
      }).ok
    ).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(parseBusinessHours(null).ok).toBe(false);
    expect(parseBusinessHours('hours').ok).toBe(false);
  });
});

describe('shouldSendAwayMessage', () => {
  const base = {
    hours: open(),
    awayMessage: 'We are closed',
    lastSentAt: null,
  };

  it('sends outside hours', () => {
    expect(shouldSendAwayMessage({ ...base, now: MON_2100_IST })).toBe(true);
  });

  it('does not send during hours, with no message, or when hours are off', () => {
    expect(shouldSendAwayMessage({ ...base, now: MON_0930_IST })).toBe(false);
    expect(
      shouldSendAwayMessage({ ...base, now: MON_2100_IST, awayMessage: '  ' })
    ).toBe(false);
    expect(
      shouldSendAwayMessage({
        ...base,
        now: MON_2100_IST,
        hours: defaultBusinessHours(),
      })
    ).toBe(false);
  });

  it('sends at most once per cooldown window', () => {
    const recent = new Date(
      MON_2100_IST.getTime() - 60 * 60 * 1000
    ).toISOString();
    const old = new Date(
      MON_2100_IST.getTime() - AWAY_MESSAGE_COOLDOWN_MS - 1000
    ).toISOString();
    expect(
      shouldSendAwayMessage({ ...base, now: MON_2100_IST, lastSentAt: recent })
    ).toBe(false);
    expect(
      shouldSendAwayMessage({ ...base, now: MON_2100_IST, lastSentAt: old })
    ).toBe(true);
  });
});

describe('pickLeastLoadedAgent', () => {
  it('returns null with no agents', () => {
    expect(pickLeastLoadedAgent([], {})).toBeNull();
  });

  it('picks the agent with the fewest open conversations', () => {
    expect(pickLeastLoadedAgent(['a', 'b', 'c'], { a: 5, b: 1, c: 3 })).toBe(
      'b'
    );
  });

  it('treats agents with no conversations as zero and breaks ties with the rng', () => {
    expect(pickLeastLoadedAgent(['a', 'b'], { a: 2 })).toBe('b');
    expect(pickLeastLoadedAgent(['a', 'b'], {}, () => 0)).toBe('a');
    expect(pickLeastLoadedAgent(['a', 'b'], {}, () => 0.99)).toBe('b');
  });
});
