import type { supabaseAdmin } from '@/lib/flows/admin-client';
import { engineSendInteractiveList } from '@/lib/flows/meta-send';
import { buildCsatList, parseCsatReplyId, shouldSendCsat } from './csat';

type AdminClient = ReturnType<typeof supabaseAdmin>;

export type CsatRequestOutcome =
  | 'sent'
  | 'disabled'
  | 'recently_sent'
  | 'not_found'
  | 'failed';

/**
 * Send the rating survey for a conversation that was just closed. Never
 * throws. Marks `csat_requested_at` first, so a double click cannot send two.
 */
export async function requestCsat(
  db: AdminClient,
  conversationId: string
): Promise<CsatRequestOutcome> {
  try {
    const { data: conv } = await db
      .from('conversations')
      .select('id, user_id, contact_id, tenant_id, csat_requested_at')
      .eq('id', conversationId)
      .maybeSingle();
    if (!conv || !conv.tenant_id) return 'not_found';

    const { data: tenant } = await db
      .from('crm_tenants')
      .select('csat_enabled, csat_message')
      .eq('id', conv.tenant_id)
      .maybeSingle();
    const now = new Date();
    if (
      !shouldSendCsat({
        enabled: tenant?.csat_enabled === true,
        lastRequestedAt: conv.csat_requested_at,
        now,
      })
    ) {
      return tenant?.csat_enabled === true ? 'recently_sent' : 'disabled';
    }

    // Claim the slot atomically (only if nobody claimed it since we read).
    const claim = db
      .from('conversations')
      .update({ csat_requested_at: now.toISOString() })
      .eq('id', conv.id);
    const { data: claimed } = await (conv.csat_requested_at
      ? claim.eq('csat_requested_at', conv.csat_requested_at)
      : claim.is('csat_requested_at', null)
    ).select('id');
    if (!claimed || claimed.length === 0) return 'recently_sent';

    try {
      await engineSendInteractiveList({
        userId: conv.user_id,
        conversationId: conv.id,
        contactId: conv.contact_id,
        ...buildCsatList(tenant?.csat_message),
      });
      return 'sent';
    } catch (err) {
      // Release the claim so a retry is possible.
      await db
        .from('conversations')
        .update({ csat_requested_at: conv.csat_requested_at ?? null })
        .eq('id', conv.id);
      console.error(
        '[csat] send failed:',
        err instanceof Error ? err.message : err
      );
      return 'failed';
    }
  } catch (err) {
    console.error('[csat] request failed:', err instanceof Error ? err.message : err);
    return 'failed';
  }
}

/**
 * Inbound hook. Returns true when the reply is a CSAT answer (`csat_1`..`csat_5`),
 * so the caller skips flows and automations. The rating is stored only when a
 * survey is pending on the chat; a stale tap is swallowed without a record.
 * Never throws.
 */
export async function recordCsatReply(
  db: AdminClient,
  args: { conversationId: string; replyId: string | null | undefined }
): Promise<boolean> {
  const score = parseCsatReplyId(args.replyId);
  if (score === null) return false;
  try {
    const { data: conv } = await db
      .from('conversations')
      .select('id, tenant_id, contact_id, assigned_agent_id, csat_requested_at')
      .eq('id', args.conversationId)
      .maybeSingle();
    if (!conv?.tenant_id || !conv.csat_requested_at) return true;

    // UNIQUE (conversation_id, requested_at): a repeat tap is a no-op.
    const { error } = await db.from('csat_responses').upsert(
      {
        tenant_id: conv.tenant_id,
        conversation_id: conv.id,
        contact_id: conv.contact_id,
        agent_id: conv.assigned_agent_id,
        score,
        requested_at: conv.csat_requested_at,
      },
      { onConflict: 'conversation_id,requested_at', ignoreDuplicates: true }
    );
    if (error) console.error('[csat] store failed:', error.message);
  } catch (err) {
    console.error('[csat] record failed:', err instanceof Error ? err.message : err);
  }
  return true;
}
