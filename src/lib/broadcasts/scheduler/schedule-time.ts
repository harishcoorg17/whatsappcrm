/** A schedule must be at least this far ahead so the user can still cancel it. */
export const MIN_LEAD_MS = 60_000;
/** Far-future dates are almost certainly typos. */
export const MAX_LEAD_MS = 365 * 24 * 60 * 60 * 1000;

export type ScheduleValidation =
  | { ok: true; scheduledAt: string }
  | { ok: false; error: string };

/**
 * Validates a user-supplied schedule time (ISO string) and normalises it to
 * UTC ISO. Pure: `now` is injected.
 */
export function validateScheduledAt(
  input: unknown,
  now: Date
): ScheduleValidation {
  if (typeof input !== 'string' || input.trim() === '') {
    return { ok: false, error: 'scheduled_at is required' };
  }
  const when = new Date(input);
  if (Number.isNaN(when.getTime())) {
    return { ok: false, error: 'scheduled_at is not a valid date' };
  }
  const lead = when.getTime() - now.getTime();
  if (lead < MIN_LEAD_MS) {
    return { ok: false, error: 'Pick a time at least a minute in the future' };
  }
  if (lead > MAX_LEAD_MS) {
    return { ok: false, error: 'Pick a time within the next year' };
  }
  return { ok: true, scheduledAt: when.toISOString() };
}
