import { NextRequest, NextResponse } from 'next/server';
import { encrypt } from '@/lib/whatsapp/encryption';
import { authorizeTenantAccess, problem } from '@/lib/tenants/authorize-tenant';
import {
  MAX_INSTRUCTIONS_CHARS,
  MAX_KNOWLEDGE_CHARS,
} from '@/lib/ai/agent-core';
import {
  DEFAULT_MODELS,
  isAiProvider,
  MAX_MODEL_LENGTH,
  type AiProvider,
} from '@/lib/ai/providers';

/**
 * A tenant's AI agent settings.
 *
 *   GET /api/tenants/[slug]/ai
 *   PUT /api/tenants/[slug]/ai
 *       { enabled, provider, model, instructions, knowledge,
 *         apiKey?, clearKey? }
 *
 * Allowed for the tenant's owner, platform admins and team admins. The
 * provider key is stored encrypted and is never sent back: the browser only
 * learns whether one is saved. Leaving `apiKey` out keeps the saved key.
 */

type Context = { params: Promise<{ slug: string }> };

const MAX_API_KEY_LENGTH = 500;

interface AiRow {
  ai_enabled: boolean | null;
  ai_provider: string | null;
  ai_model: string | null;
  ai_api_key_enc: string | null;
  ai_instructions: string | null;
  ai_knowledge: string | null;
}

function toResponse(row: AiRow | null) {
  const provider = isAiProvider(row?.ai_provider) ? row?.ai_provider : null;
  return {
    enabled: row?.ai_enabled === true,
    provider,
    model: row?.ai_model ?? '',
    instructions: row?.ai_instructions ?? '',
    knowledge: row?.ai_knowledge ?? '',
    hasKey: !!row?.ai_api_key_enc,
  };
}

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { slug } = await context.params;
    const auth = await authorizeTenantAccess(slug, { allowTeamAdmins: true });
    if (!auth.ok) return auth.response;

    const { data, error } = await auth.db
      .from('crm_tenants')
      .select(
        'ai_enabled, ai_provider, ai_model, ai_api_key_enc, ai_instructions, ai_knowledge'
      )
      .eq('id', auth.tenant.id)
      .maybeSingle();
    if (error) {
      console.error('[tenants/ai] load failed:', error.message);
      return problem(
        'Could not load AI settings. Has the latest migration been applied?',
        500
      ).response;
    }
    return NextResponse.json(toResponse((data as AiRow | null) ?? null));
  } catch (error) {
    console.error('[tenants/ai] unexpected error:', error);
    return problem('Could not load AI settings', 500).response;
  }
}

export async function PUT(request: NextRequest, context: Context) {
  try {
    const { slug } = await context.params;
    const auth = await authorizeTenantAccess(slug, { allowTeamAdmins: true });
    if (!auth.ok) return auth.response;

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    if (typeof body.enabled !== 'boolean') {
      return problem('enabled must be true or false', 400).response;
    }
    if (!isAiProvider(body.provider)) {
      return problem('Choose an AI provider', 400).response;
    }
    const provider: AiProvider = body.provider;

    const model = typeof body.model === 'string' ? body.model.trim() : '';
    if (model.length > MAX_MODEL_LENGTH) {
      return problem('That model name is too long', 400).response;
    }
    const instructions =
      typeof body.instructions === 'string' ? body.instructions.trim() : '';
    if (instructions.length > MAX_INSTRUCTIONS_CHARS) {
      return problem(
        `Keep the instructions under ${MAX_INSTRUCTIONS_CHARS} characters`,
        400
      ).response;
    }
    const knowledge =
      typeof body.knowledge === 'string' ? body.knowledge.trim() : '';
    if (knowledge.length > MAX_KNOWLEDGE_CHARS) {
      return problem(
        `Keep the business information under ${MAX_KNOWLEDGE_CHARS} characters`,
        400
      ).response;
    }

    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    if (apiKey.length > MAX_API_KEY_LENGTH || /\s/.test(apiKey)) {
      return problem('That API key does not look right', 400).response;
    }

    const { data: existing } = await auth.db
      .from('crm_tenants')
      .select('ai_api_key_enc')
      .eq('id', auth.tenant.id)
      .maybeSingle();
    const hadKey = !!(existing as { ai_api_key_enc: string | null } | null)
      ?.ai_api_key_enc;

    const update: Record<string, unknown> = {
      ai_enabled: body.enabled,
      ai_provider: provider,
      ai_model: model || DEFAULT_MODELS[provider],
      ai_instructions: instructions || null,
      ai_knowledge: knowledge || null,
    };
    if (body.clearKey === true) update.ai_api_key_enc = null;
    else if (apiKey) update.ai_api_key_enc = encrypt(apiKey);

    const willHaveKey = body.clearKey === true ? false : apiKey ? true : hadKey;
    if (body.enabled && !willHaveKey) {
      return problem('Add the provider API key to turn the AI on', 400)
        .response;
    }

    const { data: saved, error } = await auth.db
      .from('crm_tenants')
      .update(update)
      .eq('id', auth.tenant.id)
      .select(
        'ai_enabled, ai_provider, ai_model, ai_api_key_enc, ai_instructions, ai_knowledge'
      )
      .maybeSingle();
    if (error) {
      console.error('[tenants/ai] save failed:', error.message);
      return problem('Could not save AI settings', 500).response;
    }
    return NextResponse.json(toResponse((saved as AiRow | null) ?? null));
  } catch (error) {
    console.error('[tenants/ai] unexpected error:', error);
    return problem('Could not save AI settings', 500).response;
  }
}
