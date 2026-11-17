import type { SupabaseClient } from '@supabase/supabase-js';
import { engineSendText } from '@/lib/flows/meta-send';
import { loadWhatsAppCredentials } from '@/lib/whatsapp/credentials';
import { sendTemplateToRecipient } from '@/lib/whatsapp/send-template-to-recipient';
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard';
import {
  MAX_INVITE_BATCH,
  SERVICE_WINDOW_MS,
  SKIP_MESSAGES,
  capBatch,
  chunk,
  planInvites,
  type InviteCandidate,
} from './eligibility';
import {
  buildInviteText,
  buildTemplateParams,
  templateVariableCount,
} from './invite-message';
import type { GroupKind } from './invite-url';

/** Concurrent Meta sends per wave. */
const SEND_CONCURRENCY = 5;

export interface InviteGroup {
  id: string;
  kind: GroupKind;
  name: string;
  invite_url: string;
  is_active: boolean;
}

export interface SendInvitesInput {
  tenantId: string;
  ownerUserId: string;
  group: InviteGroup;
  contactIds: readonly string[];
  tagId?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  now?: Date;
}

export interface InviteOutcome {
  contactId: string;
  name: string | null;
  status: 'sent' | 'failed' | 'skipped';
  reason?: string;
}

export type SendInvitesResult =
  | {
      ok: true;
      outcomes: InviteOutcome[];
      counts: { sent: number; failed: number; skipped: number };
      /** Requested contacts cut because of the batch cap. */
      dropped: number;
    }
  | { ok: false; status: number; error: string };

interface ContactRow {
  id: string;
  phone: string | null;
  name: string | null;
  opt_in_status: string | null;
  tenant_id: string | null;
}

const fail = (status: number, error: string): SendInvitesResult => ({
  ok: false,
  status,
  error,
});

/** Ids of the owner's contacts carrying a tag the owner owns. */
async function contactIdsForTag(
  db: SupabaseClient,
  ownerUserId: string,
  tagId: string
): Promise<string[] | null> {
  const { data: tag } = await db
    .from('tags')
    .select('id')
    .eq('id', tagId)
    .eq('user_id', ownerUserId)
    .maybeSingle();
  if (!tag) return null;
  const { data, error } = await db
    .from('contact_tags')
    .select('contact_id')
    .eq('tag_id', tagId)
    .limit(5000);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ contact_id: string }>).map((r) => r.contact_id);
}

async function loadTemplate(
  db: SupabaseClient,
  ownerUserId: string,
  name: string,
  language: string
) {
  const { data } = await db
    .from('message_templates')
    .select('*')
    .eq('user_id', ownerUserId)
    .eq('name', name)
    .eq('language', language)
    .maybeSingle();
  if (!data || !isMessageTemplate(data)) return null;
  return data;
}

/** contact id -> newest conversation id, and who wrote inside the window. */
async function loadWindowData(
  db: SupabaseClient,
  ownerUserId: string,
  contactIds: string[],
  now: Date
) {
  const conversationByContact = new Map<string, string>();
  const lastInboundAt = new Map<string, string>();

  const { data: convs } = await db
    .from('conversations')
    .select('id, contact_id')
    .eq('user_id', ownerUserId)
    .in('contact_id', contactIds)
    .order('last_message_at', { ascending: false, nullsFirst: false });
  const contactByConversation = new Map<string, string>();
  for (const c of (convs ?? []) as Array<{ id: string; contact_id: string }>) {
    contactByConversation.set(c.id, c.contact_id);
    if (!conversationByContact.has(c.contact_id)) {
      conversationByContact.set(c.contact_id, c.id);
    }
  }
  if (contactByConversation.size === 0) {
    return { conversationByContact, lastInboundAt };
  }

  const cutoff = new Date(now.getTime() - SERVICE_WINDOW_MS).toISOString();
  const { data: msgs } = await db
    .from('messages')
    .select('conversation_id, created_at')
    .eq('sender_type', 'customer')
    .gte('created_at', cutoff)
    .in('conversation_id', [...contactByConversation.keys()])
    .order('created_at', { ascending: false });
  for (const m of (msgs ?? []) as Array<{
    conversation_id: string;
    created_at: string;
  }>) {
    const contactId = contactByConversation.get(m.conversation_id);
    if (contactId && !lastInboundAt.has(contactId)) {
      lastInboundAt.set(contactId, m.created_at);
      // The window is per conversation: send into the one that is open.
      conversationByContact.set(contactId, m.conversation_id);
    }
  }
  return { conversationByContact, lastInboundAt };
}

/**
 * Reserve the invite row first so two clicks (or two tabs) can never send the
 * same person the same link twice. Returns false when it already existed.
 */
async function reserveInvite(
  db: SupabaseClient,
  groupId: string,
  contactId: string
): Promise<boolean> {
  const { data, error } = await db
    .from('whatsapp_group_invites')
    .upsert(
      { group_id: groupId, contact_id: contactId, status: 'sent' },
      { onConflict: 'group_id,contact_id', ignoreDuplicates: true }
    )
    .select('id');
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

async function releaseInvite(
  db: SupabaseClient,
  groupId: string,
  contactId: string
): Promise<void> {
  await db
    .from('whatsapp_group_invites')
    .delete()
    .eq('group_id', groupId)
    .eq('contact_id', contactId);
}

export async function sendGroupInvites(
  db: SupabaseClient,
  input: SendInvitesInput
): Promise<SendInvitesResult> {
  const now = input.now ?? new Date();
  const { group } = input;
  if (!group.is_active) {
    return fail(400, 'This group is switched off. Turn it on to send invites.');
  }

  // 1. Who was asked for (manual selection and/or a tag), capped.
  const requested = new Set(input.contactIds);
  if (input.tagId) {
    const tagged = await contactIdsForTag(db, input.ownerUserId, input.tagId);
    if (tagged === null) return fail(404, 'That tag was not found');
    for (const id of tagged) requested.add(id);
  }
  if (requested.size === 0) return fail(400, 'Choose at least one contact');
  const { kept: ids, dropped } = capBatch([...requested], MAX_INVITE_BATCH);

  // 2. Optional approved template for contacts outside the 24h window.
  let template: Awaited<ReturnType<typeof loadTemplate>> = null;
  if (input.templateName) {
    template = await loadTemplate(
      db,
      input.ownerUserId,
      input.templateName,
      input.templateLanguage || 'en_US'
    );
    if (!template) return fail(400, 'That template was not found');
    if (template.status !== 'APPROVED') {
      return fail(400, 'That template is not approved by WhatsApp yet');
    }
    if (templateVariableCount(template.body_text) > 3) {
      return fail(400, 'Use a template with at most 3 variables: {{1}} first name, {{2}} group name, {{3}} link');
    }
  }

  // 3. Load contacts (this owner's, and this tenant's or unassigned).
  const { data: contactRows, error: contactError } = await db
    .from('contacts')
    .select('id, phone, name, opt_in_status, tenant_id')
    .eq('user_id', input.ownerUserId)
    .in('id', ids);
  if (contactError) {
    console.error('[whatsapp-groups] contacts load failed:', contactError.message);
    return fail(500, 'Could not load contacts');
  }
  const contacts = ((contactRows ?? []) as ContactRow[]).filter(
    (c) => !c.tenant_id || c.tenant_id === input.tenantId
  );
  if (contacts.length === 0) return fail(404, 'No matching contacts found');

  const candidates: Array<InviteCandidate & { contactName: string | null }> =
    contacts.map((c) => ({
      id: c.id,
      phone: c.phone,
      name: c.name,
      contactName: c.name,
      optInStatus: c.opt_in_status,
    }));

  const { data: invitedRows } = await db
    .from('whatsapp_group_invites')
    .select('contact_id')
    .eq('group_id', group.id)
    .in('contact_id', ids);
  const alreadyInvitedIds = new Set(
    ((invitedRows ?? []) as Array<{ contact_id: string }>).map((r) => r.contact_id)
  );

  const { conversationByContact, lastInboundAt } = await loadWindowData(
    db,
    input.ownerUserId,
    candidates.map((c) => c.id),
    now
  );

  const plan = planInvites({
    candidates,
    alreadyInvitedIds,
    lastInboundAt,
    hasTemplate: template !== null,
    now,
  });

  const outcomes: InviteOutcome[] = plan.skipped.map(({ contact, reason }) => ({
    contactId: contact.id,
    name: contact.name,
    status: 'skipped',
    reason: SKIP_MESSAGES[reason],
  }));

  // 4. Send. Text invites go through the engine; template invites use the
  // broadcast sender.
  let credentials: Awaited<ReturnType<typeof loadWhatsAppCredentials>> = null;
  if (plan.template.length > 0) {
    credentials = await loadWhatsAppCredentials(db, input.ownerUserId, input.tenantId);
    if (!credentials) return fail(400, 'WhatsApp is not connected for this workspace');
  }

  const sendOne = async (
    contact: (typeof candidates)[number],
    mode: 'text' | 'template'
  ): Promise<InviteOutcome> => {
    const base = { contactId: contact.id, name: contact.name };
    let reserved = false;
    try {
      reserved = await reserveInvite(db, group.id, contact.id);
      if (!reserved) {
        return { ...base, status: 'skipped', reason: SKIP_MESSAGES.already_invited };
      }
      if (mode === 'text') {
        const conversationId = conversationByContact.get(contact.id);
        if (!conversationId) throw new Error('No conversation for this contact');
        await engineSendText({
          userId: input.ownerUserId,
          conversationId,
          contactId: contact.id,
          text: buildInviteText({
            kind: group.kind,
            name: group.name,
            url: group.invite_url,
            contactName: contact.contactName,
          }),
        });
      } else {
        const outcome = await sendTemplateToRecipient({
          phoneNumberId: credentials!.phoneNumberId,
          accessToken: credentials!.accessToken,
          templateName: template!.name,
          language: template!.language || 'en_US',
          template: template!,
          recipient: {
            phone: contact.phone!,
            params: buildTemplateParams(templateVariableCount(template!.body_text), {
              name: group.name,
              url: group.invite_url,
              contactName: contact.contactName,
            }),
          },
        });
        if (!outcome.ok) throw new Error(outcome.error);
      }
      return { ...base, status: 'sent' };
    } catch (error) {
      if (reserved) {
        await releaseInvite(db, group.id, contact.id).catch(() => undefined);
      }
      const message = error instanceof Error ? error.message : 'Send failed';
      console.error('[whatsapp-groups] invite failed:', message);
      return { ...base, status: 'failed', reason: message.slice(0, 200) };
    }
  };

  const jobs = [
    ...plan.text.map((c) => ({ c, mode: 'text' as const })),
    ...plan.template.map((c) => ({ c, mode: 'template' as const })),
  ];
  for (const wave of chunk(jobs, SEND_CONCURRENCY)) {
    outcomes.push(...(await Promise.all(wave.map((j) => sendOne(j.c, j.mode)))));
  }

  const counts = {
    sent: outcomes.filter((o) => o.status === 'sent').length,
    failed: outcomes.filter((o) => o.status === 'failed').length,
    skipped: outcomes.filter((o) => o.status === 'skipped').length,
  };
  return { ok: true, outcomes, counts, dropped };
}
