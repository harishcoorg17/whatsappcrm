/**
 * Saves a template the CRM sent on behalf of another system into the inbox,
 * so agents see it in the customer's conversation, replies thread under it,
 * and Meta's delivery receipts match a message the CRM knows about.
 *
 * Contacts and conversations are scoped to the tenant, the same way the
 * inbound webhook scopes them.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { phonesMatch } from '@/lib/whatsapp/phone-utils';
import type { RecordArgs } from './send-template';

async function findOrCreateContactId(
  db: SupabaseClient,
  args: RecordArgs
): Promise<string> {
  const { data: contacts } = await db
    .from('contacts')
    .select('id, phone')
    .eq('user_id', args.ownerUserId)
    .eq('tenant_id', args.tenantId);

  const existing = (
    contacts as Array<{ id: string; phone: string }> | null
  )?.find((contact) => phonesMatch(contact.phone, args.phone));
  if (existing) return existing.id;

  const { data: created, error } = await db
    .from('contacts')
    .insert({
      user_id: args.ownerUserId,
      tenant_id: args.tenantId,
      phone: args.phone,
      name: args.contactName?.trim() || args.phone,
    })
    .select('id')
    .single();
  if (error || !created) {
    throw new Error(`could not create contact: ${error?.message ?? 'no row'}`);
  }
  return (created as { id: string }).id;
}

async function findOrCreateConversationId(
  db: SupabaseClient,
  args: RecordArgs,
  contactId: string
): Promise<string> {
  const { data: existing } = await db
    .from('conversations')
    .select('id')
    .eq('user_id', args.ownerUserId)
    .eq('contact_id', contactId)
    .eq('tenant_id', args.tenantId)
    .maybeSingle();
  if (existing) return (existing as { id: string }).id;

  const { data: created, error } = await db
    .from('conversations')
    .insert({
      user_id: args.ownerUserId,
      contact_id: contactId,
      tenant_id: args.tenantId,
    })
    .select('id')
    .single();
  if (error || !created) {
    throw new Error(
      `could not create conversation: ${error?.message ?? 'no row'}`
    );
  }
  return (created as { id: string }).id;
}

export async function recordOutboundTemplate(
  db: SupabaseClient,
  args: RecordArgs
): Promise<{ conversationId: string }> {
  const contactId = await findOrCreateContactId(db, args);
  const conversationId = await findOrCreateConversationId(db, args, contactId);

  const { error: messageError } = await db.from('messages').insert({
    conversation_id: conversationId,
    sender_type: 'bot',
    content_type: 'template',
    content_text: args.bodyText,
    template_name: args.templateName,
    message_id: args.messageId,
    status: 'sent',
  });
  if (messageError) {
    throw new Error(`could not save message: ${messageError.message}`);
  }

  const now = new Date().toISOString();
  await db
    .from('conversations')
    .update({
      last_message_text: args.bodyText,
      last_message_at: now,
      updated_at: now,
    })
    .eq('id', conversationId);

  return { conversationId };
}
