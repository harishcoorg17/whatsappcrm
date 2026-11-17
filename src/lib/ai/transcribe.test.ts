import { describe, expect, it } from 'vitest';
import {
  MAX_TRANSCRIPT_CHARS,
  baseMimeType,
  buildTranscriptionRequest,
  canTranscribe,
  cleanTranscript,
  extractTranscript,
} from './transcribe';

const audio = Buffer.from('fake-audio-bytes');

describe('baseMimeType', () => {
  it('drops codec parameters and lowercases', () => {
    expect(baseMimeType('Audio/OGG; codecs=opus')).toBe('audio/ogg');
    expect(baseMimeType(null)).toBe('');
  });
});

describe('canTranscribe', () => {
  it('accepts WhatsApp voice notes for OpenAI and Gemini', () => {
    expect(canTranscribe('openai', 'audio/ogg; codecs=opus')).toBe(true);
    expect(canTranscribe('gemini', 'audio/ogg; codecs=opus')).toBe(true);
  });

  it('rejects providers without audio and formats they do not read', () => {
    expect(canTranscribe('anthropic', 'audio/ogg')).toBe(false);
    expect(canTranscribe('openrouter', 'audio/ogg')).toBe(false);
    expect(canTranscribe('openai', 'audio/amr')).toBe(false);
    expect(canTranscribe('gemini', 'video/mp4')).toBe(false);
    expect(canTranscribe('gemini', undefined)).toBe(false);
  });
});

describe('cleanTranscript', () => {
  it('collapses whitespace and caps the length', () => {
    expect(cleanTranscript('  hello \n  there  ')).toBe('hello there');
    expect(cleanTranscript('a'.repeat(MAX_TRANSCRIPT_CHARS + 50))).toHaveLength(
      MAX_TRANSCRIPT_CHARS
    );
  });

  it('returns null when there was no speech', () => {
    expect(cleanTranscript('   ')).toBeNull();
    expect(cleanTranscript(null)).toBeNull();
  });
});

describe('buildTranscriptionRequest', () => {
  it('posts multipart audio to OpenAI with a bearer key', () => {
    const req = buildTranscriptionRequest({
      provider: 'openai',
      apiKey: 'k',
      model: 'gpt-4o-mini',
      audio,
      mimeType: 'audio/ogg; codecs=opus',
    });
    expect(req.url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(req.headers).toEqual({ Authorization: 'Bearer k' });
    const form = req.body as FormData;
    expect(form.get('model')).toBe('whisper-1');
    expect((form.get('file') as File).name).toBe('voice.ogg');
  });

  it('sends Gemini the audio inline with the tenant model', () => {
    const req = buildTranscriptionRequest({
      provider: 'gemini',
      apiKey: 'k',
      model: 'gemini-2.0-flash',
      audio,
      mimeType: 'audio/ogg',
    });
    expect(req.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent'
    );
    expect(req.headers['x-goog-api-key']).toBe('k');
    const body = JSON.parse(req.body as string);
    const inline = body.contents[0].parts[1].inline_data;
    expect(inline.mime_type).toBe('audio/ogg');
    expect(Buffer.from(inline.data, 'base64').toString()).toBe(
      'fake-audio-bytes'
    );
  });

  it('refuses providers and formats that cannot transcribe', () => {
    expect(() =>
      buildTranscriptionRequest({
        provider: 'anthropic',
        apiKey: 'k',
        model: 'm',
        audio,
        mimeType: 'audio/ogg',
      })
    ).toThrow();
    expect(() =>
      buildTranscriptionRequest({
        provider: 'openai',
        apiKey: 'k',
        model: 'm',
        audio,
        mimeType: 'audio/amr',
      })
    ).toThrow();
  });
});

describe('extractTranscript', () => {
  it('reads each provider response shape', () => {
    expect(extractTranscript('openai', { text: 'hi there' })).toBe('hi there');
    expect(
      extractTranscript('gemini', {
        candidates: [{ content: { parts: [{ text: 'namaste' }] } }],
      })
    ).toBe('namaste');
  });

  it('returns empty for malformed payloads', () => {
    expect(extractTranscript('openai', null)).toBe('');
    expect(extractTranscript('openai', { text: 5 })).toBe('');
    expect(extractTranscript('anthropic', { text: 'x' })).toBe('');
  });
});
