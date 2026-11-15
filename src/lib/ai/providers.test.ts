import { describe, expect, it } from 'vitest';
import {
  AI_PROVIDERS,
  buildProviderRequest,
  DEFAULT_MODELS,
  extractProviderText,
  isAiProvider,
  type ProviderCall,
} from './providers';

const call = (provider: ProviderCall['provider']): ProviderCall => ({
  provider,
  apiKey: 'test-key',
  model: DEFAULT_MODELS[provider],
  system: 'Be helpful',
  messages: [
    { role: 'user', content: 'Hi' },
    { role: 'assistant', content: 'Hello' },
    { role: 'user', content: 'Price?' },
  ],
});

describe('isAiProvider', () => {
  it('accepts the supported providers only', () => {
    for (const p of AI_PROVIDERS) expect(isAiProvider(p)).toBe(true);
    expect(isAiProvider('cohere')).toBe(false);
    expect(isAiProvider(undefined)).toBe(false);
  });
});

describe('buildProviderRequest', () => {
  it('sends Claude the system prompt separately with its own key header', () => {
    const req = buildProviderRequest(call('anthropic'));
    expect(req.url).toBe('https://api.anthropic.com/v1/messages');
    expect(req.headers['x-api-key']).toBe('test-key');
    expect(req.headers['anthropic-version']).toBeTruthy();
    const body = req.body as { system: string; messages: unknown[] };
    expect(body.system).toBe('Be helpful');
    expect(body.messages).toHaveLength(3);
  });

  it('puts the system prompt first for OpenAI and OpenRouter', () => {
    for (const provider of ['openai', 'openrouter'] as const) {
      const req = buildProviderRequest(call(provider));
      expect(req.headers.Authorization).toBe('Bearer test-key');
      const body = req.body as { messages: Array<{ role: string }> };
      expect(body.messages[0].role).toBe('system');
      expect(body.messages).toHaveLength(4);
    }
    expect(buildProviderRequest(call('openai')).url).toContain(
      'api.openai.com'
    );
    expect(buildProviderRequest(call('openrouter')).url).toContain(
      'openrouter.ai'
    );
  });

  it('maps assistant to model for Gemini and keeps the key out of the URL', () => {
    const req = buildProviderRequest(call('gemini'));
    expect(req.url).toContain('generativelanguage.googleapis.com');
    expect(req.url).not.toContain('test-key');
    expect(req.headers['x-goog-api-key']).toBe('test-key');
    const body = req.body as { contents: Array<{ role: string }> };
    expect(body.contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
  });

  it('escapes the model name in the Gemini URL', () => {
    const req = buildProviderRequest({
      ...call('gemini'),
      model: 'a/b?c',
    });
    expect(req.url).toContain('a%2Fb%3Fc:generateContent');
  });
});

describe('extractProviderText', () => {
  it('reads Claude text blocks', () => {
    expect(
      extractProviderText('anthropic', {
        content: [
          { type: 'text', text: 'one ' },
          { type: 'tool_use' },
          { type: 'text', text: 'two' },
        ],
      })
    ).toBe('one two');
  });

  it('reads OpenAI-style choices', () => {
    const payload = { choices: [{ message: { content: 'hello' } }] };
    expect(extractProviderText('openai', payload)).toBe('hello');
    expect(extractProviderText('openrouter', payload)).toBe('hello');
  });

  it('reads Gemini candidates', () => {
    expect(
      extractProviderText('gemini', {
        candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }],
      })
    ).toBe('ab');
  });

  it('returns an empty string for unexpected payloads', () => {
    for (const p of AI_PROVIDERS) {
      expect(extractProviderText(p, null)).toBe('');
      expect(extractProviderText(p, {})).toBe('');
      expect(extractProviderText(p, { choices: [] })).toBe('');
    }
  });
});
