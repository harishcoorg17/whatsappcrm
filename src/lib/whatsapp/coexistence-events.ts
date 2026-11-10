/**
 * Parsers for the three WhatsApp webhooks that coexistence adds.
 *
 * A number used in both the WhatsApp Business app and the API sends:
 *  - `smb_message_echoes`: messages the business sent from the phone app;
 *  - `history`: past chats, delivered in chunks after the one-time sync;
 *  - `smb_app_state_sync`: the phone's contacts.
 *
 * Everything here is pure: it turns Meta's payload into plain objects the
 * storage layer can write, and never touches the network or the database.
 */

export const COEXISTENCE_FIELDS = [
  'smb_message_echoes',
  'history',
  'smb_app_state_sync',
] as const;

export function isCoexistenceField(field: string): boolean {
  return (COEXISTENCE_FIELDS as readonly string[]).includes(field);
}

export type StoredContentType =
  | 'text'
  | 'image'
  | 'document'
  | 'audio'
  | 'video'
  | 'location'
  | 'template';

export type StoredStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface CoexistenceMessage {
  messageId: string;
  /** `outbound` was sent by the business, `inbound` by the customer. */
  direction: 'outbound' | 'inbound';
  contactPhone: string;
  contentType: StoredContentType;
  contentText: string | null;
  status: StoredStatus;
  /** ISO time, or null when Meta sent no usable timestamp. */
  createdAt: string | null;
}

export interface HistoryResult {
  messages: CoexistenceMessage[];
  progress: number | null;
  phase: number | null;
  errors: Array<{ code: number; message: string }>;
}

export interface ContactChange {
  action: 'add' | 'remove';
  phone: string;
  name: string | null;
}

type Obj = Record<string, unknown>;

function asObject(value: unknown): Obj | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Obj)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function digits(value: string): string {
  return value.replace(/\D/g, '');
}

/** Meta timestamps are seconds since the epoch, as a string or number. */
function toIso(timestamp: unknown): string | null {
  const seconds = Number(timestamp);
  if (
    timestamp === undefined ||
    timestamp === null ||
    !Number.isFinite(seconds)
  ) {
    return null;
  }
  return new Date(seconds * 1000).toISOString();
}

const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document']);

function describeContent(message: Obj): {
  contentType: StoredContentType;
  contentText: string;
} {
  const type = asString(message.type);

  if (type === 'text') {
    return {
      contentType: 'text',
      contentText: asString(asObject(message.text)?.body) ?? '',
    };
  }
  if (type && MEDIA_TYPES.has(type)) {
    const caption = asString(asObject(message[type])?.caption);
    return {
      contentType: type as StoredContentType,
      contentText: caption ?? `[${type}]`,
    };
  }
  if (type === 'media_placeholder') {
    return {
      contentType: 'text',
      contentText: '[Media not included in synced history]',
    };
  }
  if (type === 'location') {
    return { contentType: 'location', contentText: '[Location]' };
  }
  return {
    contentType: 'text',
    contentText: type ? `[${type} message]` : '[unsupported message]',
  };
}

export function parseMessageEchoes(value: unknown): CoexistenceMessage[] {
  const echoes = asArray(asObject(value)?.message_echoes);
  const messages: CoexistenceMessage[] = [];

  for (const raw of echoes) {
    const echo = asObject(raw);
    const messageId = asString(echo?.id);
    const to = asString(echo?.to);
    if (!echo || !messageId || !to) continue;

    messages.push({
      messageId,
      direction: 'outbound',
      contactPhone: to,
      ...describeContent(echo),
      status: 'sent',
      createdAt: toIso(echo.timestamp),
    });
  }
  return messages;
}

function mapHistoryStatus(
  direction: 'outbound' | 'inbound',
  status: unknown
): StoredStatus {
  // A customer's message was received by definition.
  if (direction === 'inbound') return 'delivered';

  switch (status) {
    case 'delivered':
      return 'delivered';
    case 'read':
    case 'played':
      return 'read';
    case 'error':
      return 'failed';
    case 'pending':
      return 'sending';
    default:
      return 'sent';
  }
}

export function parseHistory(value: unknown): HistoryResult {
  const result: HistoryResult = {
    messages: [],
    progress: null,
    phase: null,
    errors: [],
  };

  for (const rawChunk of asArray(asObject(value)?.history)) {
    const chunk = asObject(rawChunk);
    if (!chunk) continue;

    const metadata = asObject(chunk.metadata);
    const progress = Number(metadata?.progress);
    if (metadata?.progress !== undefined && Number.isFinite(progress)) {
      result.progress = Math.max(result.progress ?? 0, progress);
    }
    const phase = Number(metadata?.phase);
    if (metadata?.phase !== undefined && Number.isFinite(phase)) {
      result.phase = phase;
    }

    for (const rawError of asArray(chunk.errors)) {
      const error = asObject(rawError);
      const code = Number(error?.code);
      if (!error || !Number.isFinite(code)) continue;
      result.errors.push({
        code,
        message:
          asString(error.message) ??
          asString(error.title) ??
          'History sync error',
      });
    }

    for (const rawThread of asArray(chunk.threads)) {
      result.messages.push(...parseThread(asObject(rawThread)));
    }
  }
  return result;
}

function parseThread(thread: Obj | null): CoexistenceMessage[] {
  const customerPhone = asString(thread?.id);
  if (!thread || !customerPhone) return [];

  const messages: CoexistenceMessage[] = [];
  for (const rawMessage of asArray(thread.messages)) {
    const message = asObject(rawMessage);
    const messageId = asString(message?.id);
    if (!message || !messageId) continue;

    const from = asString(message.from);
    const direction =
      from && digits(from) === digits(customerPhone) ? 'inbound' : 'outbound';

    messages.push({
      messageId,
      direction,
      contactPhone: customerPhone,
      ...describeContent(message),
      status: mapHistoryStatus(
        direction,
        asObject(message.history_context)?.status
      ),
      createdAt: toIso(message.timestamp),
    });
  }
  return messages;
}

export function parseContactSync(value: unknown): ContactChange[] {
  const changes: ContactChange[] = [];

  for (const raw of asArray(asObject(value)?.state_sync)) {
    const entry = asObject(raw);
    if (!entry || entry.type !== 'contact') continue;

    const contact = asObject(entry.contact);
    const phone = asString(contact?.phone_number);
    if (!contact || !phone) continue;

    changes.push({
      action: entry.action === 'remove' ? 'remove' : 'add',
      phone,
      name: asString(contact.full_name) ?? asString(contact.first_name),
    });
  }
  return changes;
}
