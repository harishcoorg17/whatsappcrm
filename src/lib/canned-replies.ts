/**
 * Canned (quick) replies: saved snippets an agent inserts into the composer by
 * typing "/" and a shortcut. Pure helpers, shared by the composer picker and
 * the Settings manager.
 */

export interface CannedReply {
  id: string;
  /** Lowercase word agents type after "/", e.g. "hours". */
  shortcut: string;
  title: string | null;
  body: string;
  /** null = available in every tenant the creator works in. */
  tenant_id: string | null;
}

export const SHORTCUT_PATTERN = /^[a-z0-9_-]{1,32}$/;
export const MAX_BODY_LENGTH = 2000;
export const MAX_TITLE_LENGTH = 80;
export const MAX_PICKER_RESULTS = 8;

export interface ReplyContext {
  /** The contact's full name; only the first name is used. */
  name?: string | null;
  phone?: string | null;
}

export type ReplyDraftErrors = Partial<
  Record<'shortcut' | 'body' | 'title', string>
>;

/** Lowercase and strip a leading "/" so "/Hours " becomes "hours". */
export function normalizeShortcut(raw: string): string {
  return raw.trim().replace(/^\/+/, '').toLowerCase();
}

export function validateReplyDraft(draft: {
  shortcut: string;
  title?: string;
  body: string;
}): ReplyDraftErrors {
  const errors: ReplyDraftErrors = {};
  if (!SHORTCUT_PATTERN.test(normalizeShortcut(draft.shortcut))) {
    errors.shortcut =
      'Use 1-32 letters, numbers, dashes or underscores, with no spaces';
  }
  if (!draft.body.trim()) {
    errors.body = 'Write the message to insert';
  } else if (draft.body.length > MAX_BODY_LENGTH) {
    errors.body = `Keep it under ${MAX_BODY_LENGTH} characters`;
  }
  if ((draft.title ?? '').length > MAX_TITLE_LENGTH) {
    errors.title = `Keep the title under ${MAX_TITLE_LENGTH} characters`;
  }
  return errors;
}

/** First word of a name, or "" when there is none. */
function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}

/**
 * Fill {{name}} (first name) and {{phone}}. A missing value becomes an empty
 * string and the surrounding whitespace is tidied, so "Hi {{name}}, ..." never
 * reaches a customer with a raw placeholder in it.
 */
export function renderReply(body: string, context: ReplyContext): string {
  const filled = body
    .replace(/\{\{\s*name\s*\}\}/gi, firstName(context.name))
    .replace(/\{\{\s*phone\s*\}\}/gi, (context.phone ?? '').trim());
  return filled.replace(/[ \t]+([,.!?;:])/g, '$1').replace(/[ \t]{2,}/g, ' ');
}

/**
 * The trigger text in the composer: "/" followed by letters and no space,
 * e.g. "/hou". Returns the query without the slash, or null when the picker
 * should stay closed.
 */
export function readSlashQuery(text: string): string | null {
  const match = /^\/([a-z0-9_-]*)$/i.exec(text);
  return match ? match[1].toLowerCase() : null;
}

/** Rank replies for a query: shortcut prefix, then shortcut/title/body contains. */
export function searchReplies(
  replies: readonly CannedReply[],
  query: string,
  limit = MAX_PICKER_RESULTS
): CannedReply[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...replies].slice(0, limit);

  const scored: Array<{ reply: CannedReply; score: number }> = [];
  for (const reply of replies) {
    const shortcut = reply.shortcut.toLowerCase();
    const title = (reply.title ?? '').toLowerCase();
    const body = reply.body.toLowerCase();
    let score = 0;
    if (shortcut === q) score = 4;
    else if (shortcut.startsWith(q)) score = 3;
    else if (shortcut.includes(q) || title.includes(q)) score = 2;
    else if (body.includes(q)) score = 1;
    if (score > 0) scored.push({ reply, score });
  }
  return scored
    .sort(
      (a, b) =>
        b.score - a.score || a.reply.shortcut.localeCompare(b.reply.shortcut)
    )
    .slice(0, limit)
    .map((s) => s.reply);
}
