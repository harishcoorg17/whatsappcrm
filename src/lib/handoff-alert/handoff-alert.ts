/**
 * Pure logic for handoff alerts: who to tell, whether to tell them again, and
 * what to say. No I/O, so it is easy to test and cannot fail a handoff.
 */

/** A chat alerts once per handoff; repeated handoffs inside this window stay quiet. */
export const HANDOFF_ALERT_COOLDOWN_MS = 10 * 60 * 1000;

export interface HandoffAlertSettings {
  email: boolean;
  whatsapp: boolean;
  /** Admin WhatsApp number as typed (e.g. "+91 98765 43210"). */
  whatsappNumber: string | null;
}

export interface AlertPlan {
  email: boolean;
  /** Digits-only number to message, or null when WhatsApp should not be used. */
  whatsappTo: string | null;
  /** Claim the chat only if it was last alerted before this ISO time. */
  claimBefore: string;
}

/** Digits only, 8-15 long (E.164 range); anything else is not a number. */
export function normalizeAlertNumber(
  raw: string | null | undefined
): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/**
 * Decide which channels to use. Returns null when nothing is switched on or
 * the chat was alerted within the cooldown.
 */
export function planHandoffAlert(args: {
  settings: HandoffAlertSettings;
  lastAlertedAt: string | null | undefined;
  now?: Date;
  cooldownMs?: number;
}): AlertPlan | null {
  const now = args.now ?? new Date();
  const cooldown = args.cooldownMs ?? HANDOFF_ALERT_COOLDOWN_MS;
  const whatsappTo = args.settings.whatsapp
    ? normalizeAlertNumber(args.settings.whatsappNumber)
    : null;
  if (!args.settings.email && !whatsappTo) return null;

  const last = args.lastAlertedAt ? Date.parse(args.lastAlertedAt) : NaN;
  if (!Number.isNaN(last) && now.getTime() - last < cooldown) return null;

  return {
    email: args.settings.email,
    whatsappTo,
    claimBefore: new Date(now.getTime() - cooldown).toISOString(),
  };
}

/** The assigned agent if known, else the tenant admins. Lowercased, de-duplicated. */
export function pickEmailRecipients(args: {
  assigneeEmail: string | null | undefined;
  adminEmails: Array<string | null | undefined>;
}): string[] {
  const clean = (e: string | null | undefined) => e?.trim().toLowerCase() || '';
  const assignee = clean(args.assigneeEmail);
  const pool = assignee ? [assignee] : args.adminEmails.map(clean);
  return [...new Set(pool.filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))];
}

const REASON_LABELS: Record<string, string> = {
  handoff_node: 'A flow handed the chat to a person',
  fallback_exhausted: 'The bot could not understand the customer',
  customer_requested: 'The customer asked for a person',
  automation: 'An automation handed the chat over',
  ai_handoff: 'The AI assistant handed the chat over',
};

export function describeHandoffReason(reason: string | null | undefined): string {
  return (reason && REASON_LABELS[reason]) || 'A chat needs a person';
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );

export function buildHandoffAlertContent(args: {
  contactName: string | null | undefined;
  contactPhone: string | null | undefined;
  reason: string | null | undefined;
  inboxUrl: string | null;
}): { subject: string; text: string; html: string } {
  const who = args.contactName?.trim() || args.contactPhone?.trim() || 'A customer';
  const reason = describeHandoffReason(args.reason);
  const subject = `Needs a person: ${who}`;
  const link = args.inboxUrl ? `\nOpen the chat: ${args.inboxUrl}` : '';
  const text = `${who} needs a human reply.\n${reason}.${link}`;
  const html =
    `<p><strong>${escapeHtml(who)}</strong> needs a human reply.</p>` +
    `<p>${escapeHtml(reason)}.</p>` +
    (args.inboxUrl
      ? `<p><a href="${escapeHtml(args.inboxUrl)}">Open the chat</a></p>`
      : '');
  return { subject, text, html };
}
