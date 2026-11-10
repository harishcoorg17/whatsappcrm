import type { SupabaseClient } from '@supabase/supabase-js';
import {
  parseContactSync,
  parseHistory,
  parseMessageEchoes,
  type CoexistenceMessage,
  type ContactChange,
} from './coexistence-events';
import { phonesMatch } from './phone-utils';

/**
 * Files coexistence data (phone-app messages, synced history and contacts)
 * under the tenant that owns the number, the same way inbound messages are.
 *
 * Nothing here triggers automations or raises unread counts: these are
 * messages the business already saw on the phone.
 */

interface Target {
  tenantId: string;
  ownerUserId: string;
}

interface ContactRow {
  id: string;
  phone: string;
  name: string | null;
}

interface ConversationRow {
  id: string;
  last_message_at: string | null;
}

export interface StoreSummary {
  field: string;
  stored: number;
  skipped: number;
  note?: string;
}

const INSERT_CHUNK = 500;
const PREVIEW_LENGTH = 200;

function digits(value: string): string {
  return value.replace(/\D/g, '');
}

/** A contact created from a phone number has the number as its name. */
function isPlaceholderName(name: string | null, phone: string): boolean {
  return !name || digits(name) === digits(phone);
}

async function resolveTarget(
  db: SupabaseClient,
  phoneNumberId: string
): Promise<Target | null> {
  const { data, error } = await db
    .from('crm_tenants')
    .select('id, owner_user_id')
    .eq('phone_number_id', phoneNumberId)
    .eq('status', 'active')
    .maybeSingle();

  if (error) {
    console.error('[coexistence] tenant lookup failed:', error.message);
    return null;
  }
  if (!data?.owner_user_id) return null;
  return { tenantId: data.id, ownerUserId: data.owner_user_id };
}

/** The tenant's contacts, loaded once per webhook and kept up to date. */
class ContactBook {
  private contacts: ContactRow[] | null = null;

  constructor(
    private readonly db: SupabaseClient,
    private readonly target: Target
  ) {}

  private async load(): Promise<ContactRow[]> {
    if (this.contacts) return this.contacts;
    const { data, error } = await this.db
      .from('contacts')
      .select('id, phone, name')
      .eq('user_id', this.target.ownerUserId)
      .eq('tenant_id', this.target.tenantId);
    if (error) {
      console.error('[coexistence] contact lookup failed:', error.message);
      throw new Error(error.message);
    }
    this.contacts = (data ?? []) as ContactRow[];
    return this.contacts;
  }

  async ensure(phone: string, name: string | null): Promise<ContactRow | null> {
    const contacts = await this.load();
    const existing = contacts.find((c) => phonesMatch(c.phone, phone));

    if (existing) {
      if (name && isPlaceholderName(existing.name, existing.phone)) {
        await this.db.from('contacts').update({ name }).eq('id', existing.id);
        const renamed = { ...existing, name };
        this.contacts = contacts.map((c) =>
          c.id === existing.id ? renamed : c
        );
        return renamed;
      }
      return existing;
    }

    const { data, error } = await this.db
      .from('contacts')
      .insert({
        user_id: this.target.ownerUserId,
        tenant_id: this.target.tenantId,
        phone,
        name: name || phone,
      })
      .select('id, phone, name')
      .single();
    if (error || !data) {
      console.error('[coexistence] could not create contact:', error?.message);
      return null;
    }
    this.contacts = [...contacts, data as ContactRow];
    return data as ContactRow;
  }
}

async function ensureConversation(
  db: SupabaseClient,
  target: Target,
  contactId: string
): Promise<ConversationRow | null> {
  const { data: existing } = await db
    .from('conversations')
    .select('id, last_message_at')
    .eq('user_id', target.ownerUserId)
    .eq('contact_id', contactId)
    .eq('tenant_id', target.tenantId)
    .maybeSingle();
  if (existing) return existing as ConversationRow;

  const { data, error } = await db
    .from('conversations')
    .insert({
      user_id: target.ownerUserId,
      contact_id: contactId,
      tenant_id: target.tenantId,
    })
    .select('id, last_message_at')
    .single();
  if (error || !data) {
    console.error(
      '[coexistence] could not create conversation:',
      error?.message
    );
    return null;
  }
  return data as ConversationRow;
}

function groupByPhone(
  messages: CoexistenceMessage[]
): Map<string, CoexistenceMessage[]> {
  const groups = new Map<string, CoexistenceMessage[]>();
  for (const message of messages) {
    const key = digits(message.contactPhone);
    groups.set(key, [...(groups.get(key) ?? []), message]);
  }
  return groups;
}

async function existingMessageIds(
  db: SupabaseClient,
  conversationId: string,
  ids: string[]
): Promise<Set<string>> {
  const { data } = await db
    .from('messages')
    .select('message_id')
    .eq('conversation_id', conversationId)
    .in('message_id', ids);
  return new Set(
    (data ?? []).map((row: { message_id: string }) => row.message_id)
  );
}

function toRow(conversationId: string, message: CoexistenceMessage) {
  return {
    conversation_id: conversationId,
    sender_type: message.direction === 'outbound' ? 'agent' : 'customer',
    content_type: message.contentType,
    content_text: message.contentText,
    message_id: message.messageId,
    status: message.status,
    ...(message.createdAt ? { created_at: message.createdAt } : {}),
  };
}

async function insertInChunks(
  db: SupabaseClient,
  rows: Array<Record<string, unknown>>
): Promise<{ stored: number; failed: number }> {
  let stored = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK);
    const { error } = await db.from('messages').insert(chunk);
    if (error) {
      console.error('[coexistence] message insert failed:', error.message);
      failed += chunk.length;
    } else {
      stored += chunk.length;
    }
  }
  return { stored, failed };
}

async function refreshLastMessage(
  db: SupabaseClient,
  conversation: ConversationRow,
  fresh: CoexistenceMessage[]
): Promise<void> {
  const dated = fresh.filter((m) => m.createdAt);
  const latest = dated.length
    ? dated.reduce((a, b) => (a.createdAt! >= b.createdAt! ? a : b))
    : fresh[fresh.length - 1];
  const latestAt = latest.createdAt ?? new Date().toISOString();

  if (
    conversation.last_message_at &&
    latestAt <= conversation.last_message_at
  ) {
    return;
  }
  await db
    .from('conversations')
    .update({
      last_message_text: (latest.contentText ?? '').slice(0, PREVIEW_LENGTH),
      last_message_at: latestAt,
    })
    .eq('id', conversation.id);
}

async function storeMessages(
  db: SupabaseClient,
  target: Target,
  messages: CoexistenceMessage[]
): Promise<{ stored: number; skipped: number }> {
  const book = new ContactBook(db, target);
  let stored = 0;
  let skipped = 0;

  for (const group of groupByPhone(messages).values()) {
    const contact = await book.ensure(group[0].contactPhone, null);
    const conversation = contact
      ? await ensureConversation(db, target, contact.id)
      : null;
    if (!conversation) {
      skipped += group.length;
      continue;
    }

    const known = await existingMessageIds(
      db,
      conversation.id,
      group.map((m) => m.messageId)
    );
    const fresh = group.filter((m) => !known.has(m.messageId));
    skipped += group.length - fresh.length;
    if (fresh.length === 0) continue;

    const result = await insertInChunks(
      db,
      fresh.map((m) => toRow(conversation.id, m))
    );
    stored += result.stored;
    skipped += result.failed;
    if (result.stored > 0) await refreshLastMessage(db, conversation, fresh);
  }
  return { stored, skipped };
}

async function storeContacts(
  db: SupabaseClient,
  target: Target,
  changes: ContactChange[]
): Promise<{ stored: number; skipped: number }> {
  const book = new ContactBook(db, target);
  let stored = 0;
  let skipped = 0;

  for (const change of changes) {
    // A contact removed on the phone is kept here: it may have a conversation
    // or deals, and deleting CRM data on a phone-side tidy-up is not safe.
    if (change.action === 'remove') {
      skipped += 1;
      continue;
    }
    const contact = await book.ensure(change.phone, change.name);
    if (contact) stored += 1;
    else skipped += 1;
  }
  return { stored, skipped };
}

function readPhoneNumberId(value: unknown): string | null {
  const metadata = (
    value as { metadata?: { phone_number_id?: unknown } } | null
  )?.metadata;
  return typeof metadata?.phone_number_id === 'string'
    ? metadata.phone_number_id
    : null;
}

async function dispatch(
  db: SupabaseClient,
  target: Target,
  field: string,
  value: unknown
): Promise<{ stored: number; skipped: number; note?: string }> {
  if (field === 'smb_message_echoes') {
    return storeMessages(db, target, parseMessageEchoes(value));
  }
  if (field === 'smb_app_state_sync') {
    return storeContacts(db, target, parseContactSync(value));
  }
  if (field === 'history') {
    const history = parseHistory(value);
    const note = history.errors.length
      ? `history errors: ${history.errors.map((e) => e.code).join(',')}`
      : history.progress !== null
        ? `progress ${history.progress}%`
        : undefined;
    return { ...(await storeMessages(db, target, history.messages)), note };
  }
  return { stored: 0, skipped: 0, note: 'unsupported field' };
}

export async function handleCoexistenceChange(
  db: SupabaseClient,
  change: { field: string; value: unknown }
): Promise<StoreSummary> {
  const { field, value } = change;
  const phoneNumberId = readPhoneNumberId(value);
  if (!phoneNumberId) {
    return { field, stored: 0, skipped: 0, note: 'no phone number id' };
  }

  const target = await resolveTarget(db, phoneNumberId);
  if (!target) {
    return {
      field,
      stored: 0,
      skipped: 0,
      note: 'no active tenant with an owner',
    };
  }

  try {
    return { field, ...(await dispatch(db, target, field, value)) };
  } catch (error) {
    console.error('[coexistence] handler failed:', error);
    return { field, stored: 0, skipped: 0, note: 'handler failed' };
  }
}
