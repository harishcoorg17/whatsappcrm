import type { supabaseAdmin } from '@/lib/flows/admin-client';
import { sendEmail } from '@/lib/email/sender';
import { loadCredentialsForConversation } from '@/lib/whatsapp/credentials';
import { sendTextMessage } from '@/lib/whatsapp/meta-api';
import {
  buildHandoffAlertContent,
  pickEmailRecipients,
  planHandoffAlert,
} from './handoff-alert';

type AdminClient = ReturnType<typeof supabaseAdmin>;

/**
 * Tell the team a chat needs a person. Reads the tenant's alert settings,
 * claims the chat atomically (so concurrent handoffs alert once), then sends
 * the email and/or WhatsApp message. Each channel is best effort.
 */
export async function dispatchHandoffAlert(
  db: AdminClient,
  args: { conversationId: string; reason: string; now?: Date }
): Promise<void> {
  const now = args.now ?? new Date();
  const { data: conv } = await db
    .from('conversations')
    .select('id, user_id, tenant_id, contact_id, assigned_agent_id, handoff_alerted_at')
    .eq('id', args.conversationId)
    .maybeSingle();
  if (!conv?.tenant_id) return;

  const { data: tenant } = await db
    .from('crm_tenants')
    .select(
      'owner_user_id, handoff_alert_email, handoff_alert_whatsapp, handoff_alert_number'
    )
    .eq('id', conv.tenant_id)
    .maybeSingle();
  if (!tenant) return;

  const plan = planHandoffAlert({
    settings: {
      email: tenant.handoff_alert_email === true,
      whatsapp: tenant.handoff_alert_whatsapp === true,
      whatsappNumber: tenant.handoff_alert_number ?? null,
    },
    lastAlertedAt: conv.handoff_alerted_at,
    now,
  });
  if (!plan) return;

  // Atomic claim: only one concurrent handoff wins the right to alert.
  const { data: claimed } = await db
    .from('conversations')
    .update({ handoff_alerted_at: now.toISOString() })
    .eq('id', conv.id)
    .or(`handoff_alerted_at.is.null,handoff_alerted_at.lt.${plan.claimBefore}`)
    .select('id');
  if (!claimed || claimed.length === 0) return;

  const { data: contact } = await db
    .from('contacts')
    .select('name, phone')
    .eq('id', conv.contact_id)
    .maybeSingle();
  const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '');
  const content = buildHandoffAlertContent({
    contactName: contact?.name,
    contactPhone: contact?.phone,
    reason: args.reason,
    inboxUrl: base ? `${base}/inbox?c=${conv.id}` : null,
  });

  const jobs: Promise<unknown>[] = [];
  if (plan.email && tenant.owner_user_id) {
    jobs.push(sendEmails(db, tenant.owner_user_id, conv, tenant, content));
  }
  if (plan.whatsappTo) {
    jobs.push(sendWhatsApp(db, conv.user_id, conv.id, plan.whatsappTo, content.text));
  }
  await Promise.allSettled(jobs);
}

async function sendEmails(
  db: AdminClient,
  ownerId: string,
  conv: { tenant_id: string; assigned_agent_id: string | null },
  tenant: { owner_user_id: string | null },
  content: { subject: string; text: string; html: string }
): Promise<void> {
  const ids = new Set<string>();
  if (conv.assigned_agent_id) {
    ids.add(conv.assigned_agent_id);
  } else {
    const { data: admins } = await db
      .from('crm_tenant_members')
      .select('user_id')
      .eq('tenant_id', conv.tenant_id)
      .eq('role', 'admin');
    for (const a of admins ?? []) ids.add(a.user_id);
    if (tenant.owner_user_id) ids.add(tenant.owner_user_id);
  }
  if (ids.size === 0) return;

  const { data: profiles } = await db
    .from('profiles')
    .select('user_id, email')
    .in('user_id', [...ids]);
  const emailOf = (id: string | null) =>
    (profiles ?? []).find((p: { user_id: string }) => p.user_id === id)?.email;
  const to = pickEmailRecipients({
    assigneeEmail: emailOf(conv.assigned_agent_id),
    adminEmails: (profiles ?? []).map((p: { email: string | null }) => p.email),
  });

  for (const address of to) {
    const result = await sendEmail({ userId: ownerId, to: address, ...content });
    if (!result.success) {
      console.error('[handoff-alert] email failed:', result.error);
    }
  }
}

async function sendWhatsApp(
  db: AdminClient,
  userId: string,
  conversationId: string,
  to: string,
  text: string
): Promise<void> {
  const credentials = await loadCredentialsForConversation(db, userId, conversationId);
  if (!credentials) return;
  try {
    await sendTextMessage({
      phoneNumberId: credentials.phoneNumberId,
      accessToken: credentials.accessToken,
      to,
      text,
    });
  } catch (err) {
    // Free-form text only works if the admin messaged this number in the last 24 hours.
    console.error(
      '[handoff-alert] whatsapp failed:',
      err instanceof Error ? err.message : err
    );
  }
}
