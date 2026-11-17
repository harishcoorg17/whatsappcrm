import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact, MessageTemplate } from '@/types';
import { loadWhatsAppCredentials } from '@/lib/whatsapp/credentials';
import { filterOptedOutRecipients } from '@/lib/whatsapp/consent';
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard';
import {
  sendTemplateToRecipient,
  type SendToRecipientArgs,
  type SendToRecipientResult,
} from '@/lib/whatsapp/send-template-to-recipient';
import {
  fetchCustomValueIndex,
  resolveSendTimeParams,
  resolveVariables,
  type VariableMapping,
} from '../variables';
import {
  claimDueBroadcasts,
  releaseBroadcastClaim,
  type ClaimedBroadcast,
} from './claim';

/** Same Meta rate-limit buffer as the interactive sender (10 + 1s pause). */
export const SEND_BATCH_SIZE = 10;
export const SEND_BATCH_DELAY_MS = 1000;
/** Stop starting new batches after this long so the run ends inside maxDuration. */
export const DEFAULT_TIME_BUDGET_MS = 45_000;

export const OPTED_OUT_ERROR = 'Opted out of marketing messages';

interface PendingRecipient {
  id: string;
  contact: Contact | null;
}

export interface RunDeps {
  db: SupabaseClient;
  send?: (args: SendToRecipientArgs) => Promise<SendToRecipientResult>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeBudgetMs?: number;
}

export type BroadcastOutcome = 'completed' | 'paused' | 'failed';

export interface RunSummary {
  claimed: number;
  outcomes: Array<{ id: string; outcome: BroadcastOutcome }>;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function finalStatus(
  total: number,
  failed: number
): 'sent' | 'failed' {
  return total > 0 && failed === total ? 'failed' : 'sent';
}

async function failPendingRecipients(
  db: SupabaseClient,
  broadcastId: string,
  message: string
): Promise<void> {
  await db
    .from('broadcast_recipients')
    .update({ status: 'failed', error_message: message })
    .eq('broadcast_id', broadcastId)
    .eq('status', 'pending');
}

async function finalizeBroadcast(
  db: SupabaseClient,
  broadcastId: string
): Promise<'sent' | 'failed'> {
  const [{ count: total }, { count: failed }] = await Promise.all([
    db
      .from('broadcast_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('broadcast_id', broadcastId),
    db
      .from('broadcast_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('broadcast_id', broadcastId)
      .eq('status', 'failed'),
  ]);
  const status = finalStatus(total ?? 0, failed ?? 0);
  await db
    .from('broadcasts')
    .update({
      status,
      completed_at: new Date().toISOString(),
      claimed_until: null,
    })
    .eq('id', broadcastId);
  return status;
}

async function loadTemplate(
  db: SupabaseClient,
  broadcast: ClaimedBroadcast
): Promise<MessageTemplate | null> {
  const { data } = await db
    .from('message_templates')
    .select('*')
    .eq('user_id', broadcast.user_id)
    .eq('name', broadcast.template_name)
    .eq('language', broadcast.template_language || 'en_US')
    .maybeSingle();
  return data && isMessageTemplate(data) ? (data as MessageTemplate) : null;
}

async function sendBatch(
  deps: Required<Pick<RunDeps, 'db' | 'send'>>,
  broadcast: ClaimedBroadcast,
  batch: PendingRecipient[],
  ctx: {
    creds: { phoneNumberId: string; accessToken: string };
    template: MessageTemplate | null;
    variables: Record<string, VariableMapping>;
  }
): Promise<void> {
  const { db, send } = deps;

  const withPhone: Array<PendingRecipient & { contact: Contact }> = [];
  for (const r of batch) {
    if (r.contact?.phone) {
      withPhone.push({ ...r, contact: r.contact });
    } else {
      await db
        .from('broadcast_recipients')
        .update({ status: 'failed', error_message: 'No phone number on contact' })
        .eq('id', r.id);
    }
  }
  if (withPhone.length === 0) return;

  // Opt-outs are re-checked at send time: a customer may have replied STOP
  // between scheduling and now.
  const { allowed, skipped } = await filterOptedOutRecipients(
    db,
    broadcast.user_id,
    withPhone.map((r) => ({ ...r, phone: r.contact.phone as string }))
  );
  for (const r of skipped) {
    await db
      .from('broadcast_recipients')
      .update({ status: 'failed', error_message: OPTED_OUT_ERROR })
      .eq('id', r.id);
  }

  const customValues = await fetchCustomValueIndex(
    db,
    allowed.map((r) => r.contact.id)
  );

  for (const r of allowed) {
    const customVals = customValues.get(r.contact.id);
    const messageParams = ctx.template
      ? resolveSendTimeParams(ctx.variables, ctx.template, r.contact, customVals)
      : undefined;
    const outcome = await send({
      phoneNumberId: ctx.creds.phoneNumberId,
      accessToken: ctx.creds.accessToken,
      templateName: broadcast.template_name,
      language: broadcast.template_language || 'en_US',
      template: ctx.template,
      recipient: {
        phone: r.contact.phone as string,
        params:
          messageParams?.body ??
          resolveVariables(ctx.variables, r.contact, customVals),
        messageParams,
      },
    });

    // Mark each recipient immediately: if the run dies mid-batch, only
    // unmarked recipients are retried by the resuming run.
    await db
      .from('broadcast_recipients')
      .update(
        outcome.ok
          ? {
              status: 'sent',
              sent_at: new Date().toISOString(),
              whatsapp_message_id: outcome.messageId,
              error_message: null,
            }
          : { status: 'failed', error_message: outcome.error }
      )
      .eq('id', r.id);
  }
}

async function processBroadcast(
  deps: RunDeps & Required<Pick<RunDeps, 'send' | 'sleep' | 'now'>>,
  broadcast: ClaimedBroadcast,
  deadline: number
): Promise<BroadcastOutcome> {
  const { db } = deps;

  const creds = await loadWhatsAppCredentials(db, broadcast.user_id);
  if (!creds) {
    await failPendingRecipients(db, broadcast.id, 'WhatsApp not configured');
    await finalizeBroadcast(db, broadcast.id);
    return 'failed';
  }
  const template = await loadTemplate(db, broadcast);
  const variables = (broadcast.template_variables ?? {}) as Record<
    string,
    VariableMapping
  >;

  while (deps.now() < deadline) {
    const { data, error } = await db
      .from('broadcast_recipients')
      .select('id, contact:contacts(*)')
      .eq('broadcast_id', broadcast.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(SEND_BATCH_SIZE);

    if (error) {
      console.error('[broadcast-cron] recipient fetch failed:', error.message);
      await releaseBroadcastClaim(db, broadcast.id);
      return 'paused';
    }
    const batch = (data ?? []) as unknown as PendingRecipient[];
    if (batch.length === 0) {
      const status = await finalizeBroadcast(db, broadcast.id);
      return status === 'failed' ? 'failed' : 'completed';
    }

    await sendBatch(
      { db, send: deps.send },
      broadcast,
      batch,
      { creds, template, variables }
    );
    await deps.sleep(SEND_BATCH_DELAY_MS);
  }

  // Out of time with recipients still pending: hand over to the next run.
  await releaseBroadcastClaim(db, broadcast.id);
  return 'paused';
}

/**
 * One cron tick: claim due broadcasts, send as many batches as fit in the
 * time budget, and either finish (sent/failed) or release the lease so the
 * next minute's run continues where this one stopped.
 */
export async function runScheduledBroadcasts(deps: RunDeps): Promise<RunSummary> {
  const full = {
    ...deps,
    send: deps.send ?? sendTemplateToRecipient,
    sleep: deps.sleep ?? defaultSleep,
    now: deps.now ?? Date.now,
  };
  const deadline = full.now() + (deps.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS);

  const claimed = await claimDueBroadcasts(deps.db);
  const outcomes: RunSummary['outcomes'] = [];

  for (const broadcast of claimed) {
    try {
      outcomes.push({
        id: broadcast.id,
        outcome: await processBroadcast(full, broadcast, deadline),
      });
    } catch (error) {
      console.error(
        `[broadcast-cron] broadcast ${broadcast.id} crashed:`,
        error instanceof Error ? error.message : error
      );
      await releaseBroadcastClaim(deps.db, broadcast.id);
      outcomes.push({ id: broadcast.id, outcome: 'paused' });
    }
  }
  return { claimed: claimed.length, outcomes };
}
