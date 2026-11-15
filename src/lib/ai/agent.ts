import { decrypt } from '@/lib/whatsapp/encryption';
import { engineSendText } from '@/lib/flows/meta-send';
import { isHumanRequest, performHandoff } from '@/lib/flows/handoff';
import type { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  buildSystemPrompt,
  HISTORY_LIMIT,
  parseAgentDecision,
  shouldAnswer,
  toChatMessages,
  type HistoryMessage,
} from './agent-core';
import {
  callProvider,
  DEFAULT_MODELS,
  isAiProvider,
  type AiProvider,
} from './providers';

type AdminClient = ReturnType<typeof supabaseAdmin>;

/**
 * Lets a tenant's AI answer a customer message, or hand the chat to a human.
 *
 * Runs after the bot flows had their turn and only for tenants that turned it
 * on and saved a provider key. It never throws: a provider outage or a bad
 * key must not hold up the customer's message, so every failure is logged and
 * the chat is simply left for the team.
 */

export interface RunAiAgentInput {
  db: AdminClient;
  tenantId: string;
  userId: string;
  conversationId: string;
  contactId: string;
  /** Plain text of the customer's message; null for media and other types. */
  inboundText: string | null;
}

export type AiAgentOutcome = 'replied' | 'handoff' | 'skipped';

interface TenantAiConfig {
  name: string | null;
  ai_enabled: boolean | null;
  ai_provider: string | null;
  ai_model: string | null;
  ai_api_key_enc: string | null;
  ai_instructions: string | null;
  ai_knowledge: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

async function loadConfig(
  db: AdminClient,
  tenantId: string
): Promise<TenantAiConfig | null> {
  const { data, error } = await db
    .from('crm_tenants')
    .select(
      'name, ai_enabled, ai_provider, ai_model, ai_api_key_enc, ai_instructions, ai_knowledge'
    )
    .eq('id', tenantId)
    .maybeSingle();
  if (error) {
    // Columns missing (migration 036 not applied): the AI is simply off.
    console.warn('[ai-agent] could not load settings:', error.message);
    return null;
  }
  return (data as TenantAiConfig | null) ?? null;
}

async function loadHistory(
  db: AdminClient,
  conversationId: string
): Promise<HistoryMessage[]> {
  const { data } = await db
    .from('messages')
    .select('sender_type, content_text, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT);
  return ((data ?? []) as HistoryMessage[]).reverse();
}

async function lastAgentMessageAt(
  db: AdminClient,
  conversationId: string
): Promise<string | null> {
  const { data } = await db
    .from('messages')
    .select('created_at')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'agent')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { created_at: string } | null)?.created_at ?? null;
}

async function countBotRepliesSince(
  db: AdminClient,
  conversationId: string,
  sinceIso: string
): Promise<number> {
  const { count } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'bot')
    .gte('created_at', sinceIso);
  return count ?? 0;
}

async function handOff(
  db: AdminClient,
  input: RunAiAgentInput,
  reason: string
): Promise<void> {
  await performHandoff(db, {
    userId: input.userId,
    conversationId: input.conversationId,
    contactId: input.contactId,
    reason: 'ai_handoff',
  });
  // Keep the AI's own note so the agent sees why the chat landed with them.
  const { error } = await db
    .from('conversations')
    .update({ handoff_reason: `ai_handoff: ${reason}` })
    .eq('id', input.conversationId);
  if (error) {
    console.error('[ai-agent] could not save handoff reason:', error.message);
  }
}

export async function runAiAgent(
  input: RunAiAgentInput
): Promise<AiAgentOutcome> {
  try {
    const config = await loadConfig(input.db, input.tenantId);
    if (!config?.ai_enabled) return 'skipped';

    const provider = config.ai_provider;
    const hasProvider = isAiProvider(provider) && !!config.ai_api_key_enc;

    const { data: conversation } = await input.db
      .from('conversations')
      .select('status')
      .eq('id', input.conversationId)
      .maybeSingle();

    const now = new Date();
    const verdict = shouldAnswer({
      enabled: true,
      configured: hasProvider,
      isText: !!input.inboundText?.trim(),
      conversationStatus:
        (conversation as { status: string | null } | null)?.status ?? null,
      lastAgentMessageAt: await lastAgentMessageAt(
        input.db,
        input.conversationId
      ),
      botRepliesLast24h: await countBotRepliesSince(
        input.db,
        input.conversationId,
        new Date(now.getTime() - DAY_MS).toISOString()
      ),
      now,
    });
    if (!verdict.answer) {
      // Quiet on purpose, so say why: this is the first thing to check when
      // "the AI did not answer".
      console.log(
        `[ai-agent] skipped (${verdict.reason}) conversation=${input.conversationId}`
      );
      return 'skipped';
    }

    // "Talk to a human" needs no model: hand off straight away.
    if (isHumanRequest({ kind: 'text', text: input.inboundText ?? '' })) {
      await handOff(input.db, input, 'Customer asked for a human');
      return 'handoff';
    }

    const messages = toChatMessages(
      await loadHistory(input.db, input.conversationId)
    );
    if (messages.length === 0) return 'skipped';

    let apiKey: string;
    try {
      apiKey = decrypt(config.ai_api_key_enc as string);
    } catch {
      console.error('[ai-agent] saved API key could not be decrypted');
      return 'skipped';
    }

    const typedProvider = provider as AiProvider;
    const raw = await callProvider({
      provider: typedProvider,
      apiKey,
      model: config.ai_model?.trim() || DEFAULT_MODELS[typedProvider],
      system: buildSystemPrompt({
        businessName: config.name?.trim() || 'this business',
        instructions: config.ai_instructions,
        knowledge: config.ai_knowledge,
      }),
      messages,
    });

    const decision = parseAgentDecision(raw);
    if (decision.type === 'handoff') {
      await handOff(input.db, input, decision.reason);
      return 'handoff';
    }

    await engineSendText({
      userId: input.userId,
      conversationId: input.conversationId,
      contactId: input.contactId,
      text: decision.text,
    });
    return 'replied';
  } catch (error) {
    console.error(
      '[ai-agent] failed:',
      error instanceof Error ? error.message : error
    );
    return 'skipped';
  }
}
