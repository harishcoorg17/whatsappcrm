import {
  ProviderHttpError,
  extractProviderText,
  type AiProvider,
} from './providers';

/**
 * Voice-note transcription with the tenant's own provider key. Only OpenAI
 * and Gemini accept audio here; for the others the agent asks the customer to
 * type instead. Hosts are fixed, like the chat calls, and the audio is only
 * ever held in memory for the duration of one request.
 */

/** A WhatsApp voice note is a few hundred KB; this leaves a lot of headroom. */
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
export const TRANSCRIBE_TIMEOUT_MS = 30_000;
export const MAX_TRANSCRIPT_CHARS = 1000;
export const OPENAI_TRANSCRIBE_MODEL = 'whisper-1';

/** Audio formats each provider's transcription accepts, mime -> extension. */
const ACCEPTED_MIME: Partial<Record<AiProvider, Record<string, string>>> = {
  openai: {
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/webm': 'webm',
    'audio/wav': 'wav',
  },
  gemini: {
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/aac': 'aac',
    'audio/wav': 'wav',
    'audio/flac': 'flac',
  },
};

/** "audio/ogg; codecs=opus" -> "audio/ogg". */
export function baseMimeType(mimeType: string | null | undefined): string {
  return (mimeType ?? '').split(';')[0].trim().toLowerCase();
}

/** True when this provider can transcribe audio of this type. */
export function canTranscribe(
  provider: AiProvider,
  mimeType: string | null | undefined
): boolean {
  const accepted = ACCEPTED_MIME[provider];
  return !!accepted && baseMimeType(mimeType) in accepted;
}

/** Tidies the transcript; null when nothing intelligible came back. */
export function cleanTranscript(
  text: string | null | undefined
): string | null {
  const cleaned = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  return cleaned.slice(0, MAX_TRANSCRIPT_CHARS);
}

export interface TranscribeInput {
  provider: AiProvider;
  apiKey: string;
  /** The tenant's chat model; Gemini transcribes with it directly. */
  model: string;
  audio: Buffer;
  mimeType: string;
}

export interface BuiltTranscriptionRequest {
  url: string;
  headers: Record<string, string>;
  /** FormData for OpenAI, a JSON string for Gemini. */
  body: FormData | string;
}

const GEMINI_PROMPT =
  'Transcribe this voice message exactly as spoken, in the original language. ' +
  'Reply with the transcript only. If there is no speech, reply with nothing.';

export function buildTranscriptionRequest(
  input: TranscribeInput
): BuiltTranscriptionRequest {
  const mime = baseMimeType(input.mimeType);
  const extension = ACCEPTED_MIME[input.provider]?.[mime];
  if (!extension) {
    throw new Error(`${input.provider} cannot transcribe ${mime || 'audio'}`);
  }

  if (input.provider === 'openai') {
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(input.audio)], { type: mime }),
      `voice.${extension}`
    );
    form.append('model', OPENAI_TRANSCRIBE_MODEL);
    form.append('response_format', 'json');
    return {
      url: 'https://api.openai.com/v1/audio/transcriptions',
      // No Content-Type: fetch sets the multipart boundary itself.
      headers: { Authorization: `Bearer ${input.apiKey}` },
      body: form,
    };
  }

  // Gemini: the only other provider with an entry in ACCEPTED_MIME.
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent`,
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': input.apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { text: GEMINI_PROMPT },
            {
              inline_data: {
                mime_type: mime,
                data: input.audio.toString('base64'),
              },
            },
          ],
        },
      ],
      generationConfig: { maxOutputTokens: 400 },
    }),
  };
}

/** The transcript text in a provider's response, or ''. */
export function extractTranscript(
  provider: AiProvider,
  payload: unknown
): string {
  if (provider === 'gemini') return extractProviderText('gemini', payload);
  if (provider === 'openai') {
    const text = (payload as { text?: unknown } | null)?.text;
    return typeof text === 'string' ? text : '';
  }
  return '';
}

/** Transcribes one voice note. Throws on HTTP errors; null when no speech. */
export async function transcribeAudio(
  input: TranscribeInput
): Promise<string | null> {
  if (input.audio.length === 0 || input.audio.length > MAX_AUDIO_BYTES) {
    throw new Error('Voice note is empty or too large to transcribe');
  }
  const req = buildTranscriptionRequest(input);
  const res = await fetch(req.url, {
    method: 'POST',
    headers: req.headers,
    body: req.body,
    redirect: 'error',
    signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
  });
  if (!res.ok) throw new ProviderHttpError(input.provider, res.status);
  return cleanTranscript(extractTranscript(input.provider, await res.json()));
}
