import type { SupabaseClient } from '@supabase/supabase-js';
import { sendTextMessage } from './meta-api';
import { normalizePhone, sanitizePhoneForMeta } from './phone-utils';

/**
 * Marketing consent for contacts.
 *
 *   - A customer opts out by sending STOP (and back in with START). Only a
 *     message that is JUST the keyword counts, so "please don't stop the
 *     delivery" never unsubscribes anyone.
 *   - Opted-out contacts are removed from every broadcast.
 *   - Every change is logged in contact_consent_events (proof of consent).
 *
 * Nothing here ever throws into the caller: a consent problem must not stop a
 * customer's message from being processed.
 */

export type ConsentStatus = 'unknown' | 'opted_in' | 'opted_out';
export type ConsentKeyword = 'opt_out' | 'opt_in';

const OPT_OUT_KEYWORDS = new Set([
  'stop',
  'stop all',
  'stopall',
  'unsubscribe',
  'unsub',
  'opt out',
  'optout',
  'opt-out',
]);
const OPT_IN_KEYWORDS = new Set([
  'start',
  'unstop',
  'subscribe',
  'opt in',
  'optin',
  'opt-in',
]);

/** Same tail length phonesMatch() compares. */
const TAIL_DIGITS = 8;

export const OPT_OUT_CONFIRMATION =
  'You have been unsubscribed and will no longer receive marketing messages from us. Reply START to subscribe again.';
export const OPT_IN_CONFIRMATION =
  'You are subscribed again. Reply STOP at any time to unsubscribe.';

/** "Stop!" / " STOP " -> opt_out; "start" -> opt_in; anything else -> null. */
export function detectConsentKeyword(
  text: string | null | undefined
): ConsentKeyword | null {
  if (!text) return null;
  const cleaned = text
    .trim()
    .toLowerCase()
    .replace(/[.!?,;:]+$/g, '')
    .replace(/\s+/g, ' ');
  if (OPT_OUT_KEYWORDS.has(cleaned)) return 'opt_out';
  if (OPT_IN_KEYWORDS.has(cleaned)) return 'opt_in';
  return null;
}

/**
 * Set a contact's consent and log it. Returns true when something changed;
 * false when the status was already that value (no duplicate log rows) or the
 * consent columns are missing (migration 035 not applied).
 */
export async function recordConsent(
  db: SupabaseClient,
  params: {
    contactId: string;
    status: ConsentStatus;
    source: string;
    note?: string | null;
    changedBy?: string | null;
    now?: Date;
  }
): Promise<boolean> {
  const { contactId, status, source } = params;
  const nowIso = (params.now ?? new Date()).toISOString();

  const { data: current, error } = await db
    .from('contacts')
    .select('opt_in_status')
    .eq('id', contactId)
    .maybeSingle();
  if (error) {
    console.warn('[consent] could not read consent:', error.message);
    return false;
  }
  if (!current || current.opt_in_status === status) return false;

  const { error: updateError } = await db
    .from('contacts')
    .update({
      opt_in_status: status,
      consent_source: source,
      ...(status === 'opted_in' ? { opt_in_at: nowIso } : {}),
      ...(status === 'opted_out' ? { opt_out_at: nowIso } : {}),
    })
    .eq('id', contactId);
  if (updateError) {
    console.error('[consent] could not update consent:', updateError.message);
    return false;
  }

  const { error: logError } = await db.from('contact_consent_events').insert({
    contact_id: contactId,
    status,
    source,
    note: params.note ?? null,
    changed_by: params.changedBy ?? null,
  });
  if (logError) {
    console.warn('[consent] could not log consent change:', logError.message);
  }
  return true;
}

export interface ConsentKeywordInput {
  db: SupabaseClient;
  contactId: string;
  contactPhone: string;
  conversationId: string;
  text: string | null | undefined;
  accessToken: string;
  /** The number the customer wrote to; null when unknown (no confirmation is sent). */
  phoneNumberId: string | null;
}

/**
 * Handle STOP / START from a customer. Returns handled=true when the message
 * was a consent keyword, so the caller can skip bots and automations for it.
 */
export async function handleConsentKeyword(
  input: ConsentKeywordInput
): Promise<{ handled: boolean; keyword: ConsentKeyword | null }> {
  const keyword = detectConsentKeyword(input.text);
  if (!keyword) return { handled: false, keyword: null };

  try {
    await recordConsent(input.db, {
      contactId: input.contactId,
      status: keyword === 'opt_out' ? 'opted_out' : 'opted_in',
      source: 'keyword',
      note: `Customer sent "${(input.text ?? '').trim().slice(0, 40)}"`,
    });

    if (input.phoneNumberId) {
      const reply =
        keyword === 'opt_out' ? OPT_OUT_CONFIRMATION : OPT_IN_CONFIRMATION;
      const sent = await sendTextMessage({
        phoneNumberId: input.phoneNumberId,
        accessToken: input.accessToken,
        to: sanitizePhoneForMeta(input.contactPhone),
        text: reply,
      });
      const { error } = await input.db.from('messages').insert({
        conversation_id: input.conversationId,
        sender_type: 'bot',
        content_type: 'text',
        content_text: reply,
        message_id: sent.messageId,
        status: 'sent',
      });
      if (error) {
        console.warn('[consent] could not record confirmation:', error.message);
      }
    }
  } catch (error) {
    console.error('[consent] keyword handling failed:', error);
  }
  return { handled: true, keyword };
}

/**
 * Split broadcast recipients into those we may message and those who opted
 * out. Matches on normalised phone numbers. If the consent columns are not
 * there yet nobody is filtered, so broadcasts keep working.
 */
export async function filterOptedOutRecipients<T extends { phone: string }>(
  db: SupabaseClient,
  userId: string,
  recipients: readonly T[]
): Promise<{ allowed: T[]; skipped: T[] }> {
  const { data, error } = await db
    .from('contacts')
    .select('phone')
    .eq('user_id', userId)
    .eq('opt_in_status', 'opted_out');
  if (error) {
    console.warn('[consent] could not load opt-outs:', error.message);
    return { allowed: [...recipients], skipped: [] };
  }
  // Match the way the rest of the app does (phonesMatch): numbers written with
  // and without a country code or trunk 0 are the same person, so compare the
  // last 8 digits too. When unsure we skip: honouring a STOP matters more than
  // reaching one extra number.
  const blockedFull = new Set<string>();
  const blockedTail = new Set<string>();
  for (const contact of (data ?? []) as Array<{ phone: string }>) {
    const digits = normalizePhone(contact.phone);
    if (!digits) continue;
    blockedFull.add(digits);
    if (digits.length >= TAIL_DIGITS)
      blockedTail.add(digits.slice(-TAIL_DIGITS));
  }
  const isBlocked = (phone: string): boolean => {
    const digits = normalizePhone(phone);
    if (!digits) return false;
    return (
      blockedFull.has(digits) ||
      (digits.length >= TAIL_DIGITS &&
        blockedTail.has(digits.slice(-TAIL_DIGITS)))
    );
  };

  const allowed: T[] = [];
  const skipped: T[] = [];
  for (const recipient of recipients) {
    (isBlocked(recipient.phone) ? skipped : allowed).push(recipient);
  }
  return { allowed, skipped };
}
