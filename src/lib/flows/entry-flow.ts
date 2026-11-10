/**
 * Which flow, if any, starts for an inbound message that has no active run.
 *
 * Precedence, highest first:
 *   1. an explicit keyword the customer typed (their stated intent wins);
 *   2. the returning-customer flow, when the backend knows this number and
 *      the customer has a booking (the whole point: greet them about THEIR
 *      trip, even on their very first WhatsApp message);
 *   3. the first-message flow, but only for a contact's first message.
 *
 * Selection is a pure function over injected collaborators; the returning
 * check (a gap rule plus a backend lookup) is its own function so both are
 * tested without a database or network.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  contextToVars,
  fetchCustomerContext,
  type CustomerContext,
} from './customer-context';
import { loadTenantApiConfig, publicHostGuard } from './tenant-api';

const DEFAULT_MIN_GAP_HOURS = 12;
const MS_PER_HOUR = 3_600_000;

export interface EntryFlowCandidate {
  id: string;
  trigger_type:
    | 'keyword'
    | 'first_inbound_message'
    | 'returning_customer'
    | 'manual';
  trigger_config: Record<string, unknown>;
}

export interface EntryFlowChoice<F extends EntryFlowCandidate> {
  flow: F;
  /** Variables to seed the run with (customer and booking details). */
  initialVars?: Record<string, string>;
}

export async function pickEntryFlow<F extends EntryFlowCandidate>(params: {
  flows: F[];
  text: string;
  isFirstInbound: boolean;
  matchesKeyword: (text: string, config: Record<string, unknown>) => boolean;
  resolveReturning: (flow: F) => Promise<Record<string, string> | null>;
}): Promise<EntryFlowChoice<F> | null> {
  const { flows, text, isFirstInbound, matchesKeyword, resolveReturning } =
    params;

  const keywordFlow = flows.find(
    (f) =>
      f.trigger_type === 'keyword' && matchesKeyword(text, f.trigger_config)
  );
  if (keywordFlow) return { flow: keywordFlow };

  for (const flow of flows.filter(
    (f) => f.trigger_type === 'returning_customer'
  )) {
    const initialVars = await resolveReturning(flow);
    if (initialVars) return { flow, initialVars };
  }

  if (isFirstInbound) {
    const first = flows.find((f) => f.trigger_type === 'first_inbound_message');
    if (first) return { flow: first };
  }
  return null;
}

export interface ReturningDeps {
  loadConfig: (
    db: SupabaseClient,
    conversationId: string | null
  ) => Promise<{ apiBase: string; apiKey: string } | null>;
  fetchContext: (args: {
    apiBase: string;
    apiKey: string;
    phone: string;
    hostGuard?: (host: string) => Promise<boolean>;
  }) => Promise<CustomerContext | null>;
}

const DEFAULT_DEPS: ReturningDeps = {
  loadConfig: loadTenantApiConfig,
  fetchContext: (args) =>
    fetchCustomerContext({ ...args, hostGuard: publicHostGuard }),
};

/**
 * Variables for a returning-customer run, or null if this message should not
 * start one. Never throws: any failure simply means "not eligible", and the
 * conversation carries on as for any other customer.
 */
export async function evaluateReturningCustomer(params: {
  db: SupabaseClient;
  config: Record<string, unknown>;
  conversationId: string;
  contactId: string;
  now?: Date;
  deps?: ReturningDeps;
}): Promise<Record<string, string> | null> {
  const { db, config, conversationId, contactId } = params;
  const now = params.now ?? new Date();
  const deps = params.deps ?? DEFAULT_DEPS;

  const gapHours =
    typeof config.min_gap_hours === 'number' && config.min_gap_hours >= 0
      ? config.min_gap_hours
      : DEFAULT_MIN_GAP_HOURS;
  const requiresBooking = config.requires_booking !== false;

  try {
    // The newest message is the one being handled now, so the one before it
    // tells how long the customer has been away. No earlier message means
    // this is their first message ever, which counts.
    const { data: recent } = await db
      .from('messages')
      .select('created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(2);
    const previous = (recent as Array<{ created_at: string }> | null)?.[1];
    if (previous) {
      const awayMs = now.getTime() - new Date(previous.created_at).getTime();
      if (awayMs < gapHours * MS_PER_HOUR) return null;
    }

    const { data: contact } = await db
      .from('contacts')
      .select('phone')
      .eq('id', contactId)
      .maybeSingle();
    const phone = (contact as { phone: string | null } | null)?.phone;
    if (!phone) return null;

    const api = await deps.loadConfig(db, conversationId);
    if (!api) return null;

    const context = await deps.fetchContext({ ...api, phone });
    if (!context) return null;
    if (requiresBooking && !context.primary) return null;

    return contextToVars(context);
  } catch (error) {
    console.error(
      '[flows] returning-customer check failed:',
      error instanceof Error ? error.message : error
    );
    return null;
  }
}
