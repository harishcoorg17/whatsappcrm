/**
 * Who may be sent a group / channel invite, and how.
 *
 * Pure functions: the route loads the data, this decides.
 *   - opted-out contacts are never messaged;
 *   - contacts already invited to this group are skipped;
 *   - inside WhatsApp's 24-hour customer-service window the invite goes as
 *     plain text; outside it only an approved template can be sent.
 */

export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Most contacts one "send invite" request may target. */
export const MAX_INVITE_BATCH = 100;

export interface InviteCandidate {
  id: string;
  phone: string | null;
  name: string | null;
  optInStatus: string | null;
}

export type SkipReason =
  | 'opted_out'
  | 'already_invited'
  | 'no_phone'
  | 'outside_window_no_template';

export interface InvitePlan<T extends InviteCandidate = InviteCandidate> {
  /** Inside the 24h window: send the invite as text. */
  text: T[];
  /** Outside the window: send the approved template. */
  template: T[];
  skipped: Array<{ contact: T; reason: SkipReason }>;
}

export function isWithinServiceWindow(
  lastInboundAt: string | Date | null | undefined,
  now: Date
): boolean {
  if (!lastInboundAt) return false;
  const at = new Date(lastInboundAt).getTime();
  if (Number.isNaN(at)) return false;
  const age = now.getTime() - at;
  return age >= 0 && age < SERVICE_WINDOW_MS;
}

export interface PlanInput<T extends InviteCandidate> {
  candidates: readonly T[];
  alreadyInvitedIds: ReadonlySet<string>;
  /** contact id -> time of their latest inbound message. */
  lastInboundAt: ReadonlyMap<string, string>;
  hasTemplate: boolean;
  now: Date;
}

export function planInvites<T extends InviteCandidate>(
  input: PlanInput<T>
): InvitePlan<T> {
  const text: T[] = [];
  const template: T[] = [];
  const skipped: Array<{ contact: T; reason: SkipReason }> = [];
  const seen = new Set<string>();

  for (const contact of input.candidates) {
    if (seen.has(contact.id)) continue;
    seen.add(contact.id);

    if (contact.optInStatus === 'opted_out') {
      skipped.push({ contact, reason: 'opted_out' });
    } else if (input.alreadyInvitedIds.has(contact.id)) {
      skipped.push({ contact, reason: 'already_invited' });
    } else if (!contact.phone) {
      skipped.push({ contact, reason: 'no_phone' });
    } else if (
      isWithinServiceWindow(input.lastInboundAt.get(contact.id), input.now)
    ) {
      text.push(contact);
    } else if (input.hasTemplate) {
      template.push(contact);
    } else {
      skipped.push({ contact, reason: 'outside_window_no_template' });
    }
  }
  return { text, template, skipped };
}

export const SKIP_MESSAGES: Record<SkipReason, string> = {
  opted_out: 'Opted out of messages',
  already_invited: 'Already invited to this group',
  no_phone: 'No phone number',
  outside_window_no_template:
    'Outside the 24-hour window and no approved template was chosen',
};

/** Split into chunks of at most `size` (default MAX_INVITE_BATCH). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error('size must be >= 1');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** Trim a requested id list to the cap, reporting how many were cut. */
export function capBatch<T>(
  items: readonly T[],
  max: number = MAX_INVITE_BATCH
): { kept: T[]; dropped: number } {
  return {
    kept: items.slice(0, max),
    dropped: Math.max(0, items.length - max),
  };
}
