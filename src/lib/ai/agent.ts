import { decrypt } from '@/lib/whatsapp/encryption';
import { engineSendText } from '@/lib/flows/meta-send';
import { isHumanRequest, performHandoff } from '@/lib/flows/handoff';
import type { supabaseAdmin } from '@/lib/flows/admin-client';
import { downloadMedia, getMediaUrl } from '@/lib/whatsapp/meta-api';
import {
  buildSystemPrompt,
  HISTORY_LIMIT,
  parseAgentDecision,
  shouldAnswer,
  toChatMessages,
  VOICE_NOT_SUPPORTED_REPLY,
  type HistoryMessage,
} from './agent-core';
import { saveLead } from './lead';
import { loadPartnerType, savePartnerType } from './partner';
import { loadTourKnowledge } from './tour-facts';
import {
  callProvider,
  DEFAULT_MODELS,
  isAiProvider,
  type AiProvider,
} from './providers';
import { MAX_AUDIO_BYTES, canTranscribe, transcribeAudio } from './transcribe';

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
  /** A voice note to transcribe when there is no text. */
  inboundAudio?: InboundAudio | null;
  /** Meta's id for the inbound message, to store the transcript against it. */
  inboundMessageId?: string | null;
}

export interface InboundAudio {
  mediaId: string;
  mimeType: string | null;
  accessToken: string;
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
  /** Absent until migration 048 is applied. */
  ai_lead_capture?: boolean | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE_COLUMNS =
  'name, ai_enabled, ai_provider, ai_model, ai_api_key_enc, ai_instructions, ai_knowledge';

async function loadConfig(
  db: AdminClient,
  tenantId: string
): Promise<TenantAiConfig | null> {
  const query = (columns: string) =>
    db.from('crm_tenants').select(columns).eq('id', tenantId).maybeSingle();

  let { data, error } = await query(`${BASE_COLUMNS}, ai_lead_capture`);
  if (error) {
    // Migration 048 not applied yet: carry on without lead capture.
    ({ data, error } = await query(BASE_COLUMNS));
  }
  if (error) {
    // Columns missing (migration 036 not applied): the AI is simply off.
    console.warn('[ai-agent] could not load settings:', error.message);
    return null;
  }
  return (data as TenantAiConfig | null) ?? null;
}

type VoiceOutcome = { kind: 'text'; text: string } | { kind: 'ask_to_type' };

/** Turns a voice note into text, or says the customer should type instead. */
async function readVoiceNote(args: {
  audio: InboundAudio;
  provider: AiProvider;
  apiKey: string;
  model: string;
}): Promise<VoiceOutcome> {
  const { audio, provider, apiKey, model } = args;
  if (!canTranscribe(provider, audio.mimeType)) {
    return { kind: 'ask_to_type' };
  }
  const { url, mimeType } = await getMediaUrl({
    mediaId: audio.mediaId,
    accessToken: audio.accessToken,
  });
  const { buffer } = await downloadMedia({
    downloadUrl: url,
    accessToken: audio.accessToken,
    maxBytes: MAX_AUDIO_BYTES,
  });
  const transcript = await transcribeAudio({
    provider,
    apiKey,
    model,
    audio: buffer,
    mimeType: audio.mimeType || mimeType,
  });
  return transcript
    ? { kind: 'text', text: transcript }
    : { kind: 'ask_to_type' };
}

/** Keeps the transcript with the message so later turns can see it. */
async function saveTranscript(
  db: AdminClient,
  conversationId: string,
  waMessageId: string | null | undefined,
  transcript: string
): Promise<void> {
  if (!waMessageId) return;
  const { error } = await db
    .from('messages')
    .update({ content_text: transcript })
    .eq('conversation_id', conversationId)
    .eq('message_id', waMessageId)
    .is('content_text', null);
  if (error) {
    console.warn('[ai-agent] could not save transcript:', error.message);
  }
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

/**
 * Read on its own so a missing column (migration 048 not applied) can never
 * take the conversation status with it: the status guard must keep working.
 */
async function loadAiResumedAt(
  db: AdminClient,
  conversationId: string
): Promise<string | null> {
  const { data, error } = await db
    .from('conversations')
    .select('ai_resumed_at')
    .eq('id', conversationId)
    .maybeSingle();
  if (error) return null;
  return (
    (data as { ai_resumed_at: string | null } | null)?.ai_resumed_at ?? null
  );
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

async function sendAiText(input: RunAiAgentInput, text: string): Promise<void> {
  await engineSendText({
    userId: input.userId,
    conversationId: input.conversationId,
    contactId: input.contactId,
    text,
    sentByAi: true,
  });
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
      isText: !!input.inboundText?.trim() || !!input.inboundAudio,
      conversationStatus:
        (conversation as { status: string | null } | null)?.status ?? null,
      lastAgentMessageAt: await lastAgentMessageAt(
        input.db,
        input.conversationId
      ),
      aiResumedAt: await loadAiResumedAt(input.db, input.conversationId),
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

    const typedProvider = provider as AiProvider;
    const model = config.ai_model?.trim() || DEFAULT_MODELS[typedProvider];
    let apiKey: string;
    try {
      apiKey = decrypt(config.ai_api_key_enc as string);
    } catch {
      console.error('[ai-agent] saved API key could not be decrypted');
      return 'skipped';
    }

    // The customer's words: typed text, or a transcribed voice note.
    let customerText = input.inboundText?.trim() ?? '';
    let transcript: string | null = null;
    if (!customerText && input.inboundAudio) {
      const voice = await readVoiceNote({
        audio: input.inboundAudio,
        provider: typedProvider,
        apiKey,
        model,
      });
      if (voice.kind === 'ask_to_type') {
        await sendAiText(input, VOICE_NOT_SUPPORTED_REPLY);
        return 'replied';
      }
      customerText = voice.text;
      transcript = voice.text;
    }

    // "Talk to a human" needs no model: hand off straight away.
    if (isHumanRequest({ kind: 'text', text: customerText })) {
      await handOff(input.db, input, 'Customer asked for a human');
      return 'handoff';
    }

    const history = await loadHistory(input.db, input.conversationId);
    // A DMC, hotel or transport vendor already identified on an earlier message.
    const knownPartner = await loadPartnerType(
      input.db,
      input.userId,
      input.contactId
    );
    // A customer who came from a tour page gets answers about that tour.
    const tourFacts = knownPartner
      ? ''
      : await loadTourKnowledge({
      db: input.db,
      conversationId: input.conversationId,
      customerTexts: [
        ...history
          .filter((m) => m.sender_type === 'customer')
          .map((m) => m.content_text),
        customerText,
      ],
    });
    const messages = toChatMessages(
      transcript
        ? [
            ...history,
            {
              sender_type: 'customer',
              content_text: transcript,
              created_at: now.toISOString(),
            },
          ]
        : history
    );
    if (messages.length === 0) return 'skipped';

    const raw = await callProvider({
      provider: typedProvider,
      apiKey,
      model,
      system: buildSystemPrompt({
        businessName: config.name?.trim() || 'this business',
        instructions: config.ai_instructions,
        knowledge: [config.ai_knowledge, tourFacts]
          .filter((part) => part?.trim())
          .join('\n\n'),
        leadCapture: !!config.ai_lead_capture && !knownPartner,
        knownPartner,
      }),
      messages,
    });

    const decision = parseAgentDecision(raw);
    if (transcript) {
      await saveTranscript(
        input.db,
        input.conversationId,
        input.inboundMessageId,
        transcript
      );
    }
    const partner = decision.partner ?? knownPartner;
    if (decision.partner && decision.partner !== knownPartner) {
      await savePartnerType({
        db: input.db,
        userId: input.userId,
        tenantId: input.tenantId,
        contactId: input.contactId,
        type: decision.partner,
      });
      console.log(
        `[ai-agent] contact ${input.contactId} identified as ${decision.partner}`
      );
    }
    if (config.ai_lead_capture && decision.lead && !partner) {
      await saveLead({
        db: input.db,
        userId: input.userId,
        tenantId: input.tenantId,
        contactId: input.contactId,
        lead: decision.lead,
      });
    }

    if (decision.type === 'handoff') {
      await handOff(input.db, input, decision.reason);
      return 'handoff';
    }

    await sendAiText(input, decision.text);
    return 'replied';
  } catch (error) {
    console.error(
      '[ai-agent] failed:',
      error instanceof Error ? error.message : error
    );
    return 'skipped';
  }
}
