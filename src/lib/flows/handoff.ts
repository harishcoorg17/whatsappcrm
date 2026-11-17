/**
 * Bot -> human handoff helpers.
 *
 * A conversation with `status = 'pending'` is handed off: the bot (flows)
 * and auto-reply automations stay silent. An agent resumes the bot by
 * setting the status back to 'open' ("Return to bot") or closing it.
 *
 * Voice calls are not implemented in this CRM; "transfer the call" means
 * transferring the chat.
 */

import { dispatchHandoffAlert } from '@/lib/handoff-alert/dispatch';
import { engineSendText } from './meta-send';
import type { supabaseAdmin } from './admin-client';

type AdminClient = ReturnType<typeof supabaseAdmin>;

export const DEFAULT_HANDOFF_MESSAGE =
  'Connecting you to a team member. They will reply here shortly.';
export const DEFAULT_OUT_OF_HOURS_MESSAGE =
  "Thanks for reaching out! Our team is offline right now, but we've passed your message on and will reply as soon as we're back.";

export type HandoffReason =
  | 'handoff_node'
  | 'fallback_exhausted'
  | 'customer_requested'
  | 'automation'
  | 'ai_handoff';

/** Statuses during which the bot must not respond. */
export function isBotSilenced(status: string | null | undefined): boolean {
  return status === 'pending';
}

const HUMAN_PHRASES = [
  'agent',
  'human',
  'person',
  'representative',
  'support',
  'talk to agent',
  'talk to a human',
  'talk to a person',
  'talk to someone',
  'speak to agent',
  'speak to a human',
  'speak to a person',
  'speak to someone',
  'speak to a representative',
  'customer care',
  'customer service',
  'live agent',
  'real person',
  'human agent',
  'need help from a human',
];

/** Conventional button/list reply ids that mean "I want a human". */
export const HUMAN_REPLY_IDS = [
  'human',
  'agent',
  'talk_to_agent',
  'talk_to_human',
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when the whole message is a request for a human. Whole-message match
 * (not substring) so "my agent booked this tour" does not escalate.
 */
export function isHumanRequest(
  message:
    | { kind: 'text'; text: string }
    | { kind: 'interactive_reply'; reply_id: string }
): boolean {
  if (message.kind === 'interactive_reply') {
    return HUMAN_REPLY_IDS.includes(message.reply_id.toLowerCase());
  }
  const t = normalize(message.text);
  if (!t) return false;
  return HUMAN_PHRASES.includes(t);
}

export interface BusinessHours {
  /** 'HH:MM' 24h, in the tenant's local time. */
  start: string;
  end: string;
  /** Minutes east of UTC (IST = 330). */
  utc_offset_minutes: number;
}

function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** No hours configured (or unparseable) → always within hours. */
export function isWithinBusinessHours(
  hours: BusinessHours | undefined | null,
  now: Date = new Date()
): boolean {
  if (!hours) return true;
  const start = toMinutes(hours.start);
  const end = toMinutes(hours.end);
  if (start === null || end === null) return true;
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const local =
    (((utcMin + (hours.utc_offset_minutes || 0)) % 1440) + 1440) % 1440;
  return start <= end
    ? local >= start && local < end
    : local >= start || local < end; // overnight window
}

export function pickHandoffMessage(args: {
  message?: string;
  out_of_hours_message?: string;
  business_hours?: BusinessHours | null;
  now?: Date;
}): string | null {
  const within = isWithinBusinessHours(args.business_hours, args.now);
  if (!within) {
    return args.out_of_hours_message?.trim() || DEFAULT_OUT_OF_HOURS_MESSAGE;
  }
  if (args.message !== undefined && args.message.trim() === '') return null;
  return args.message?.trim() || DEFAULT_HANDOFF_MESSAGE;
}

export interface PerformHandoffArgs {
  userId: string;
  conversationId: string;
  contactId: string;
  reason: HandoffReason;
  assignTo?: string;
  message?: string;
  out_of_hours_message?: string;
  business_hours?: BusinessHours | null;
}

/**
 * Flip the conversation to handed-off and acknowledge the customer.
 * Never throws: the acknowledgement is best-effort, the status flip is not.
 */
export async function performHandoff(
  db: AdminClient,
  args: PerformHandoffArgs
): Promise<{ ackSent: boolean }> {
  const now = new Date().toISOString();
  const update: Record<string, unknown> = {
    status: 'pending',
    handoff_at: now,
    handoff_reason: args.reason,
    updated_at: now,
  };
  if (args.assignTo) update.assigned_agent_id = args.assignTo;
  const { error } = await db
    .from('conversations')
    .update(update)
    .eq('id', args.conversationId);
  if (error) {
    console.error('[handoff] conversation update failed:', error.message);
  }

  // Alert the team (email / WhatsApp, if the tenant turned it on). Isolated so
  // a failure here can never break the handoff itself.
  if (!error) {
    try {
      await dispatchHandoffAlert(db, {
        conversationId: args.conversationId,
        reason: args.reason,
      });
    } catch (err) {
      console.error(
        '[handoff] agent alert failed:',
        err instanceof Error ? err.message : err
      );
    }
  }

  const text = pickHandoffMessage(args);
  if (!text) return { ackSent: false };
  try {
    await engineSendText({
      userId: args.userId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      text,
    });
    return { ackSent: true };
  } catch (err) {
    console.error(
      '[handoff] ack send failed:',
      err instanceof Error ? err.message : err
    );
    return { ackSent: false };
  }
}
