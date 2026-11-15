/**
 * Business hours and agent picking for inbound conversations. Pure functions,
 * used by the webhook rules and the tenant settings route.
 */

export const WEEKDAYS = [
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'sun',
] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface DayHours {
  /** 24-hour "HH:MM" in the tenant's timezone. */
  open: string;
  close: string;
}

export interface BusinessHours {
  enabled: boolean;
  /** IANA timezone, e.g. "Asia/Kolkata". */
  timezone: string;
  /** null = closed all day. */
  days: Record<Weekday, DayHours | null>;
}

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';
export const MAX_AWAY_MESSAGE_LENGTH = 1000;
/** Send the away message at most once per conversation in this window. */
export const AWAY_MESSAGE_COOLDOWN_MS = 12 * 60 * 60 * 1000;

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function defaultBusinessHours(): BusinessHours {
  const weekday: DayHours = { open: '09:00', close: '18:00' };
  return {
    enabled: false,
    timezone: DEFAULT_TIMEZONE,
    days: {
      mon: weekday,
      tue: weekday,
      wed: weekday,
      thu: weekday,
      fri: weekday,
      sat: null,
      sun: null,
    },
  };
}

const toMinutes = (time: string): number => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check untrusted input and return clean hours, or the reasons it is invalid.
 * Hours must open and close on the same day (close after open).
 */
export function parseBusinessHours(
  input: unknown
): { ok: true; hours: BusinessHours } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'Business hours are required' };
  }
  const raw = input as Record<string, unknown>;
  const timezone = typeof raw.timezone === 'string' ? raw.timezone : '';
  if (!isValidTimezone(timezone)) {
    return { ok: false, error: 'Choose a valid timezone' };
  }
  if (typeof raw.days !== 'object' || raw.days === null) {
    return { ok: false, error: 'Set the opening hours for each day' };
  }
  const days = {} as Record<Weekday, DayHours | null>;
  for (const day of WEEKDAYS) {
    const value = (raw.days as Record<string, unknown>)[day];
    if (value === null || value === undefined) {
      days[day] = null;
      continue;
    }
    const entry = value as Record<string, unknown>;
    const open = typeof entry.open === 'string' ? entry.open : '';
    const close = typeof entry.close === 'string' ? entry.close : '';
    if (!TIME_PATTERN.test(open) || !TIME_PATTERN.test(close)) {
      return { ok: false, error: `Use HH:MM times for ${day.toUpperCase()}` };
    }
    if (toMinutes(close) <= toMinutes(open)) {
      return {
        ok: false,
        error: `On ${day.toUpperCase()}, closing time must be after opening time`,
      };
    }
    days[day] = { open, close };
  }
  return {
    ok: true,
    hours: { enabled: raw.enabled === true, timezone, days },
  };
}

/** Weekday and minutes since midnight at `now` in the given timezone. */
function localClock(
  now: Date,
  timezone: string
): { day: Weekday; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const day = get('weekday').slice(0, 3).toLowerCase() as Weekday;
  return { day, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

/**
 * Whether the business is open at `now`. Hours that are not enabled count as
 * always open, so a tenant that never configured them is never "closed".
 */
export function isWithinBusinessHours(
  now: Date,
  hours: BusinessHours
): boolean {
  if (!hours.enabled) return true;
  const { day, minutes } = localClock(now, hours.timezone);
  const today = hours.days[day];
  if (!today) return false;
  return minutes >= toMinutes(today.open) && minutes < toMinutes(today.close);
}

/** True when an away message should go out now (not sent recently). */
export function shouldSendAwayMessage(params: {
  now: Date;
  hours: BusinessHours;
  awayMessage: string | null | undefined;
  lastSentAt: string | null | undefined;
}): boolean {
  const { now, hours, awayMessage, lastSentAt } = params;
  if (!awayMessage?.trim() || !hours.enabled) return false;
  if (isWithinBusinessHours(now, hours)) return false;
  if (lastSentAt) {
    const last = Date.parse(lastSentAt);
    if (
      Number.isFinite(last) &&
      now.getTime() - last < AWAY_MESSAGE_COOLDOWN_MS
    ) {
      return false;
    }
  }
  return true;
}

/**
 * The agent with the fewest open conversations; ties go to a random one among
 * the least loaded so work spreads out even when everyone is idle.
 */
export function pickLeastLoadedAgent(
  agentIds: readonly string[],
  openCounts: Readonly<Record<string, number>>,
  random: () => number = Math.random
): string | null {
  if (agentIds.length === 0) return null;
  const load = (id: string) => openCounts[id] ?? 0;
  const min = Math.min(...agentIds.map(load));
  const least = agentIds.filter((id) => load(id) === min);
  return least[Math.min(Math.floor(random() * least.length), least.length - 1)];
}
