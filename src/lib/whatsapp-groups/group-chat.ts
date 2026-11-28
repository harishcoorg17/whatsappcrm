/**
 * WhatsApp group chats in the inbox. Meta delivers a group's messages to the normal `messages` webhook,
 * each with a `group_id` and the participant who wrote it. Each group has one conversation, filed under a
 * placeholder contact whose phone starts with "group:", so it can never be messaged or broadcast to as a person.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export const GROUP_CONTACT_PREFIX = 'group:';

export const groupContactPhone = (waGroupId: string): string =>
  `${GROUP_CONTACT_PREFIX}${waGroupId}`;

export const isGroupContactPhone = (
  phone: string | null | undefined
): boolean => !!phone && phone.startsWith(GROUP_CONTACT_PREFIX);

/** Who wrote a group message, for display: their WhatsApp name, else their number, else a generic label. */
export function describeGroupSender(input: {
  name?: string | null;
  waId?: string | null;
}): string {
  const name = input.name?.trim();
  if (name) return name;
  const digits = input.waId?.replace(/\D/g, '');
  return digits ? `+${digits}` : 'Participant';
}

const STORED_TYPES = [
  'text',
  'image',
  'document',
  'audio',
  'video',
  'location',
] as const;
type StoredType = (typeof STORED_TYPES)[number];

/** The stored content type; anything the inbox cannot show (stickers, polls, …) is kept as text. */
export function groupContentType(
  mediaType: string | null | undefined
): StoredType {
  return (STORED_TYPES as readonly string[]).includes(mediaType ?? '')
    ? (mediaType as StoredType)
    : 'text';
}

export interface GroupMessageInput {
  tenantId: string;
  ownerUserId: string;
  waGroupId: string;
  /** Meta's id of the message, used to ignore Meta's retries. */
  messageId: string;
  sender: { name?: string | null; waId?: string | null };
  content: {
    text: string | null;
    mediaUrl: string | null;
    mediaType: string | null;
  };
}

export type GroupMessageOutcome =
  | 'stored'
  | 'duplicate'
  | 'unknown_group'
  | 'failed';

const PLACEHOLDER_TEXT = '[Message not shown]';

/** Saves one inbound group message. Never throws. */
export async function recordGroupMessage(
  db: SupabaseClient,
  input: GroupMessageInput
): Promise<GroupMessageOutcome> {
  try {
    const { data: group } = await db
      .from('whatsapp_groups')
      .select('id, name')
      .eq('tenant_id', input.tenantId)
      .eq('wa_group_id', input.waGroupId)
      .maybeSingle();
    if (!group) return 'unknown_group';
    const groupName = (group as { name: string }).name;

    const { data: seen } = await db
      .from('messages')
      .select('id')
      .eq('message_id', input.messageId)
      .limit(1);
    if (((seen ?? []) as unknown[]).length > 0) return 'duplicate';

    const contactId = await findOrCreateGroupContact(db, input, groupName);
    const conversation = await findOrCreateGroupConversation(
      db,
      input,
      contactId
    );
    if (!contactId || !conversation) return 'failed';

    const text =
      input.content.text?.trim() ||
      (input.content.mediaUrl ? null : PLACEHOLDER_TEXT);
    const { error } = await db.from('messages').insert({
      conversation_id: conversation.id,
      sender_type: 'customer',
      sender_name: describeGroupSender(input.sender),
      sender_wa_id: input.sender.waId?.replace(/\D/g, '') || null,
      content_type: groupContentType(input.content.mediaType),
      content_text: text,
      media_url: input.content.mediaUrl,
      message_id: input.messageId,
      status: 'delivered',
    });
    if (error) {
      console.error('[group-chat] could not save message:', error.message);
      return 'failed';
    }

    await db
      .from('conversations')
      .update({
        last_message_text:
          `${describeGroupSender(input.sender)}: ${text ?? '[media]'}`.slice(
            0,
            200
          ),
        last_message_at: new Date().toISOString(),
        unread_count: conversation.unread_count + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversation.id);
    return 'stored';
  } catch (error) {
    console.error(
      '[group-chat] failed:',
      error instanceof Error ? error.message : error
    );
    return 'failed';
  }
}

async function findOrCreateGroupContact(
  db: SupabaseClient,
  input: GroupMessageInput,
  groupName: string
): Promise<string | null> {
  const phone = groupContactPhone(input.waGroupId);
  const { data: existing } = await db
    .from('contacts')
    .select('id, name')
    .eq('user_id', input.ownerUserId)
    .eq('tenant_id', input.tenantId)
    .eq('phone', phone)
    .maybeSingle();
  if (existing) {
    const row = existing as { id: string; name: string | null };
    if (row.name !== groupName) {
      await db.from('contacts').update({ name: groupName }).eq('id', row.id);
    }
    return row.id;
  }
  const { data: created, error } = await db
    .from('contacts')
    .insert({
      user_id: input.ownerUserId,
      tenant_id: input.tenantId,
      phone,
      name: groupName,
    })
    .select('id')
    .single();
  if (error || !created) {
    console.error(
      '[group-chat] could not create the group contact:',
      error?.message
    );
    return null;
  }
  return (created as { id: string }).id;
}

async function findOrCreateGroupConversation(
  db: SupabaseClient,
  input: GroupMessageInput,
  contactId: string | null
): Promise<{ id: string; unread_count: number } | null> {
  if (!contactId) return null;
  const { data: existing } = await db
    .from('conversations')
    .select('id, unread_count')
    .eq('tenant_id', input.tenantId)
    .eq('wa_group_id', input.waGroupId)
    .maybeSingle();
  if (existing) {
    const row = existing as { id: string; unread_count: number | null };
    return { id: row.id, unread_count: row.unread_count ?? 0 };
  }
  const { data: created, error } = await db
    .from('conversations')
    .insert({
      user_id: input.ownerUserId,
      contact_id: contactId,
      tenant_id: input.tenantId,
      wa_group_id: input.waGroupId,
    })
    .select('id, unread_count')
    .single();
  if (error || !created) {
    console.error(
      '[group-chat] could not create the conversation:',
      error?.message
    );
    return null;
  }
  const row = created as { id: string; unread_count: number | null };
  return { id: row.id, unread_count: row.unread_count ?? 0 };
}
