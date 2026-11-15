/**
 * AI provider adapters. Every provider is asked the same thing (a system
 * prompt plus the chat so far, answer as JSON) and returns plain text; the
 * decision parsing lives in agent-core.ts, so adding a provider means adding
 * one request builder and one text extractor here.
 *
 * Hosts are fixed (never taken from tenant input), so a tenant cannot point
 * the server at an internal address.
 */

export const AI_PROVIDERS = [
  'anthropic',
  'openai',
  'openrouter',
  'gemini',
] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: 'Claude (Anthropic)',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  gemini: 'Google Gemini',
};

/** Starting suggestions; tenants can type any model their key can use. */
export const DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: 'claude-haiku-5-5',
  openai: 'gpt-4o-mini',
  openrouter: 'openai/gpt-4o-mini',
  gemini: 'gemini-2.0-flash',
};

export const MAX_OUTPUT_TOKENS = 500;
export const PROVIDER_TIMEOUT_MS = 20_000;
export const MAX_MODEL_LENGTH = 120;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ProviderCall {
  provider: AiProvider;
  apiKey: string;
  model: string;
  system: string;
  messages: ChatMessage[];
}

export interface BuiltRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export function isAiProvider(value: unknown): value is AiProvider {
  return (
    typeof value === 'string' &&
    (AI_PROVIDERS as readonly string[]).includes(value)
  );
}

export function buildProviderRequest(call: ProviderCall): BuiltRequest {
  const { provider, apiKey, model, system, messages } = call;
  const json = { 'Content-Type': 'application/json' };

  switch (provider) {
    case 'anthropic':
      return {
        url: 'https://api.anthropic.com/v1/messages',
        headers: {
          ...json,
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: { model, max_tokens: MAX_OUTPUT_TOKENS, system, messages },
      };
    case 'openai':
      return {
        url: 'https://api.openai.com/v1/chat/completions',
        headers: { ...json, Authorization: `Bearer ${apiKey}` },
        body: {
          model,
          max_completion_tokens: MAX_OUTPUT_TOKENS,
          response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: system }, ...messages],
        },
      };
    case 'openrouter':
      // Not every routed model supports JSON mode, so ask in the prompt only.
      return {
        url: 'https://openrouter.ai/api/v1/chat/completions',
        headers: { ...json, Authorization: `Bearer ${apiKey}` },
        body: {
          model,
          max_tokens: MAX_OUTPUT_TOKENS,
          messages: [{ role: 'system', content: system }, ...messages],
        },
      };
    case 'gemini':
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        headers: { ...json, 'x-goog-api-key': apiKey },
        body: {
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
          generationConfig: {
            responseMimeType: 'application/json',
            maxOutputTokens: MAX_OUTPUT_TOKENS,
          },
        },
      };
  }
}

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>;
}
interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}
interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

/** The model's text answer, or '' when the response has none. */
export function extractProviderText(
  provider: AiProvider,
  payload: unknown
): string {
  if (!payload || typeof payload !== 'object') return '';
  switch (provider) {
    case 'anthropic':
      return ((payload as AnthropicResponse).content ?? [])
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text as string)
        .join('');
    case 'openai':
    case 'openrouter':
      return (
        (payload as ChatCompletionResponse).choices?.[0]?.message?.content ?? ''
      );
    case 'gemini':
      return ((payload as GeminiResponse).candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? '')
        .join('');
  }
}

/** Calls the provider and returns its text. Throws with the HTTP status. */
export async function callProvider(call: ProviderCall): Promise<string> {
  const req = buildProviderRequest(call);
  const res = await fetch(req.url, {
    method: 'POST',
    headers: req.headers,
    body: JSON.stringify(req.body),
    redirect: 'error',
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`${call.provider} returned HTTP ${res.status}`);
  }
  return extractProviderText(call.provider, await res.json());
}
