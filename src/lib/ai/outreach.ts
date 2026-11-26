/**
 * Conversations the business started (an outreach template sent by Amstago or the app, a broadcast) and
 * conversations with a partner such as a DMC must not get the default customer replies: the bot menu that
 * asks which tour they want to travel on, welcome automations, the lead questions or the away message.
 * Those chats get a short, polite reply that fits the conversation, or one fixed thank-you.
 */

import type { supabaseAdmin } from '@/lib/flows/admin-client';
import { PARTNER_TAG_PREFIX } from './partner';

type AdminClient = ReturnType<typeof supabaseAdmin>;

export type OutreachReason = 'partner_tag' | 'business_initiated';

/** Tag names, besides the "partner-…" tags the AI saves, that mark a contact as a DMC. */
const DMC_TAG_NAMES = ['dmc'];

/** The one fixed reply when the AI cannot answer. Sent at most once a day per conversation. */
export const THANK_YOU_REPLY =
  'Thank you for your reply. Our team will go through it and get back to you shortly.';

const DAY_MS = 24 * 60 * 60 * 1000;

export function isPartnerTagName(name: string): boolean {
  const normalised = name.trim().toLowerCase();
  return (
    normalised.startsWith(PARTNER_TAG_PREFIX) ||
    DMC_TAG_NAMES.includes(normalised)
  );
}

/** Pure: why this chat is an outreach chat, or null for an ordinary customer chat. */
export function decideOutreach(input: {
  tagNames: string[];
  /** Who sent the conversation's very first message; null when there are no messages. */
  firstSender: 'customer' | 'agent' | 'bot' | null;
}): OutreachReason | null {
  if (input.tagNames.some(isPartnerTagName)) return 'partner_tag';
  if (input.firstSender && input.firstSender !== 'customer')
    return 'business_initiated';
  return null;
}

/** Looks up the contact's tags and who spoke first. Never throws: on a lookup problem it is an ordinary chat. */
export async function detectOutreach(
  db: AdminClient,
  input: { userId: string; contactId: string; conversationId: string }
): Promise<OutreachReason | null> {
  try {
    const { data: links } = await db
      .from('contact_tags')
      .select('tag_id')
      .eq('contact_id', input.contactId);
    const tagIds = ((links ?? []) as Array<{ tag_id: string }>).map(
      (l) => l.tag_id
    );
    let tagNames: string[] = [];
    if (tagIds.length > 0) {
      const { data: tags } = await db
        .from('tags')
        .select('name')
        .eq('user_id', input.userId)
        .in('id', tagIds);
      tagNames = ((tags ?? []) as Array<{ name: string }>).map((t) => t.name);
    }

    const { data: first } = await db
      .from('messages')
      .select('sender_type')
      .eq('conversation_id', input.conversationId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    return decideOutreach({
      tagNames,
      firstSender:
        (first as { sender_type: 'customer' | 'agent' | 'bot' } | null)
          ?.sender_type ?? null,
    });
  } catch (error) {
    console.error(
      '[outreach] lookup failed:',
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

/** True when the fixed thank-you already went out in this conversation within the last day. */
export async function thankYouSentRecently(
  db: AdminClient,
  conversationId: string,
  now: Date = new Date()
): Promise<boolean> {
  const { data } = await db
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'bot')
    .eq('content_text', THANK_YOU_REPLY)
    .gte('created_at', new Date(now.getTime() - DAY_MS).toISOString())
    .limit(1);
  return ((data ?? []) as unknown[]).length > 0;
}
