import type { SupabaseClient } from '@supabase/supabase-js';
import {
  AWAY_MESSAGE_COOLDOWN_MS,
  parseBusinessHours,
  pickLeastLoadedAgent,
  shouldSendAwayMessage,
} from './business-hours';
import { sendTextMessage } from './meta-api';
import { sanitizePhoneForMeta } from './phone-utils';

/**
 * Rules applied to every inbound customer message of a tenant, after the
 * message is stored:
 *   1. auto-assign: an unassigned chat goes to the least-busy team member;
 *   2. away message: outside business hours, once per chat per 12 hours.
 *
 * Both are off until the tenant turns them on, and every failure is logged
 * and swallowed: a rule problem must never stop a customer's message from
 * being processed.
 */

export interface InboundRuleInput {
  db: SupabaseClient;
  tenantId: string;
  conversation: {
    id: string;
    assigned_agent_id?: string | null;
    away_sent_at?: string | null;
  };
  contactPhone: string;
  accessToken: string;
  /** The tenant number the customer wrote to; the away message leaves from it. */
  phoneNumberId: string | null;
  /** True when a bot flow is already talking to the customer. */
  suppressAway: boolean;
  now?: Date;
}

export interface InboundRuleResult {
  assignedTo: string | null;
  awaySent: boolean;
}

interface TenantRules {
  business_hours: unknown;
  away_message: string | null;
  auto_assign: boolean | null;
}

async function loadRules(
  db: SupabaseClient,
  tenantId: string
): Promise<TenantRules | null> {
  const { data, error } = await db
    .from('crm_tenants')
    .select('business_hours, away_message, auto_assign')
    .eq('id', tenantId)
    .maybeSingle();
  if (error) {
    // Columns missing (migration 032 not applied): the rules are simply off.
    console.warn('[inbound-rules] could not load tenant rules:', error.message);
    return null;
  }
  return (data as TenantRules | null) ?? null;
}

async function autoAssign(
  db: SupabaseClient,
  tenantId: string,
  conversationId: string
): Promise<string | null> {
  const { data: members } = await db
    .from('crm_tenant_members')
    .select('user_id')
    .eq('tenant_id', tenantId);
  const agentIds = ((members ?? []) as Array<{ user_id: string }>).map(
    (m) => m.user_id
  );
  if (agentIds.length === 0) return null;

  const { data: open } = await db
    .from('conversations')
    .select('assigned_agent_id')
    .eq('tenant_id', tenantId)
    .in('assigned_agent_id', agentIds)
    .neq('status', 'closed');
  const counts: Record<string, number> = {};
  for (const row of (open ?? []) as Array<{ assigned_agent_id: string }>) {
    counts[row.assigned_agent_id] = (counts[row.assigned_agent_id] ?? 0) + 1;
  }

  const chosen = pickLeastLoadedAgent(agentIds, counts);
  if (!chosen) return null;

  // Only fill an empty slot, so an agent who grabbed the chat first keeps it.
  const { data: updated } = await db
    .from('conversations')
    .update({ assigned_agent_id: chosen })
    .eq('id', conversationId)
    .is('assigned_agent_id', null)
    .select('id');
  return (updated ?? []).length > 0 ? chosen : null;
}

async function sendAway(
  db: SupabaseClient,
  input: InboundRuleInput,
  message: string,
  now: Date
): Promise<boolean> {
  if (!input.phoneNumberId) return false;

  // Claim the slot first: two messages arriving together must not both send.
  const cutoff = new Date(
    now.getTime() - AWAY_MESSAGE_COOLDOWN_MS
  ).toISOString();
  const { data: claimed } = await db
    .from('conversations')
    .update({ away_sent_at: now.toISOString() })
    .eq('id', input.conversation.id)
    .or(`away_sent_at.is.null,away_sent_at.lt.${cutoff}`)
    .select('id');
  if ((claimed ?? []).length === 0) return false;

  const result = await sendTextMessage({
    phoneNumberId: input.phoneNumberId,
    accessToken: input.accessToken,
    to: sanitizePhoneForMeta(input.contactPhone),
    text: message,
  });

  const { error } = await db.from('messages').insert({
    conversation_id: input.conversation.id,
    sender_type: 'bot',
    content_type: 'text',
    content_text: message,
    message_id: result.messageId,
    status: 'sent',
  });
  if (error) {
    console.error(
      '[inbound-rules] could not record away message:',
      error.message
    );
  }
  return true;
}

export async function applyInboundRules(
  input: InboundRuleInput
): Promise<InboundRuleResult> {
  const result: InboundRuleResult = { assignedTo: null, awaySent: false };
  const now = input.now ?? new Date();

  try {
    const rules = await loadRules(input.db, input.tenantId);
    if (!rules) return result;

    if (rules.auto_assign && !input.conversation.assigned_agent_id) {
      try {
        result.assignedTo = await autoAssign(
          input.db,
          input.tenantId,
          input.conversation.id
        );
      } catch (error) {
        console.error('[inbound-rules] auto-assign failed:', error);
      }
    }

    if (!input.suppressAway && rules.away_message) {
      const parsed = parseBusinessHours(rules.business_hours);
      if (
        parsed.ok &&
        shouldSendAwayMessage({
          now,
          hours: parsed.hours,
          awayMessage: rules.away_message,
          lastSentAt: input.conversation.away_sent_at,
        })
      ) {
        try {
          result.awaySent = await sendAway(
            input.db,
            input,
            rules.away_message.trim(),
            now
          );
        } catch (error) {
          console.error('[inbound-rules] away message failed:', error);
        }
      }
    }
  } catch (error) {
    console.error('[inbound-rules] unexpected error:', error);
  }
  return result;
}
