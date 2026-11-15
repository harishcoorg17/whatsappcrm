import { NextRequest, NextResponse } from 'next/server';
import { decrypt } from '@/lib/whatsapp/encryption';
import { authorizeTenantAccess, problem } from '@/lib/tenants/authorize-tenant';
import { parseAgentDecision } from '@/lib/ai/agent-core';
import {
  callProvider,
  DEFAULT_MODELS,
  describeProviderError,
  isAiProvider,
  MAX_MODEL_LENGTH,
  PROVIDER_LABELS,
} from '@/lib/ai/providers';

/**
 * Checks a provider key before the AI is switched on.
 *
 *   POST /api/tenants/[slug]/ai/test   { provider, model?, apiKey? }
 *
 * Sends one tiny request. With no `apiKey` the saved key is used. The answer
 * is always 200 with { ok, error?, warning? }: a rejected key is a result to
 * show, not a server failure. The key is never logged or returned.
 */

type Context = { params: Promise<{ slug: string }> };

const MAX_API_KEY_LENGTH = 500;
const TEST_SYSTEM_PROMPT =
  'Reply with exactly this JSON and nothing else: {"action":"reply","text":"ok"}';

export async function POST(request: NextRequest, context: Context) {
  try {
    const { slug } = await context.params;
    const auth = await authorizeTenantAccess(slug, { allowTeamAdmins: true });
    if (!auth.ok) return auth.response;

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!isAiProvider(body.provider)) {
      return problem('Choose an AI provider', 400).response;
    }
    const provider = body.provider;

    const model =
      (typeof body.model === 'string' ? body.model.trim() : '') ||
      DEFAULT_MODELS[provider];
    if (model.length > MAX_MODEL_LENGTH) {
      return problem('That model name is too long', 400).response;
    }

    let apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    if (apiKey.length > MAX_API_KEY_LENGTH || /\s/.test(apiKey)) {
      return problem('That API key does not look right', 400).response;
    }

    if (!apiKey) {
      const { data } = await auth.db
        .from('crm_tenants')
        .select('ai_provider, ai_api_key_enc')
        .eq('id', auth.tenant.id)
        .maybeSingle();
      const saved = data as {
        ai_provider: string | null;
        ai_api_key_enc: string | null;
      } | null;
      if (!saved?.ai_api_key_enc) {
        return problem('Paste an API key to test it', 400).response;
      }
      if (saved.ai_provider !== provider) {
        return problem(
          `The saved key is for another provider. Paste your ${PROVIDER_LABELS[provider]} key to test it.`,
          400
        ).response;
      }
      try {
        apiKey = decrypt(saved.ai_api_key_enc);
      } catch {
        return problem(
          'The saved key could not be read. Paste it again and save.',
          400
        ).response;
      }
    }

    try {
      const text = await callProvider({
        provider,
        apiKey,
        model,
        system: TEST_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: 'ping' }],
      });
      const decision = parseAgentDecision(text);
      if (decision.type !== 'reply') {
        return NextResponse.json({
          ok: true,
          warning:
            'The key works, but this model did not follow the reply format. Customers would be handed to your team too often. Try a stronger model.',
        });
      }
      return NextResponse.json({ ok: true });
    } catch (error) {
      console.warn(
        '[tenants/ai/test] provider check failed:',
        error instanceof Error ? error.name : 'unknown'
      );
      return NextResponse.json({
        ok: false,
        error: describeProviderError(error, provider),
      });
    }
  } catch (error) {
    console.error('[tenants/ai/test] unexpected error:', error);
    return problem('Could not test the key', 500).response;
  }
}
