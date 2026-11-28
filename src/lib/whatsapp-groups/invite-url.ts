/**
 * Strict validation for WhatsApp group / channel input.
 *
 * Invite links are sent to customers, so only the two official WhatsApp
 * link shapes are accepted. Anything else (other hosts, http, credentials,
 * ports, extra paths or query strings) is rejected.
 */

export type GroupKind = 'group' | 'channel';

export const MAX_URL_LENGTH = 300;
export const MAX_NAME_LENGTH = 120;
export const MAX_DESCRIPTION_LENGTH = 500;
export const MAX_CAPACITY = 1024;

const URL_PATTERNS: Record<GroupKind, RegExp> = {
  group: /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]+$/,
  channel: /^https:\/\/whatsapp\.com\/channel\/[A-Za-z0-9_-]+$/,
};

export const URL_HINTS: Record<GroupKind, string> = {
  group: 'Group links look like https://chat.whatsapp.com/…',
  channel: 'Channel links look like https://whatsapp.com/channel/…',
};

export function isGroupKind(value: unknown): value is GroupKind {
  return value === 'group' || value === 'channel';
}

export type ValidatedUrl =
  | { ok: true; url: string }
  | { ok: false; error: string };

/** Returns the trimmed link when it is a valid invite link for `kind`. */
export function validateInviteUrl(kind: GroupKind, raw: unknown): ValidatedUrl {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Paste the invite link' };
  }
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: 'Paste the invite link' };
  // WhatsApp adds tracking like ?mode=gi_t when a link is copied. Keep only the link itself, so what is
  // stored and sent is always the strict form.
  const url = trimmed.replace(/[?#].*$/, '').replace(/\/+$/, '');
  if (url.length > MAX_URL_LENGTH) {
    return { ok: false, error: 'That link is too long' };
  }
  if (!URL_PATTERNS[kind].test(url)) {
    return { ok: false, error: URL_HINTS[kind] };
  }
  return { ok: true, url };
}

export interface GroupInput {
  kind: GroupKind;
  name: string;
  invite_url: string;
  description: string | null;
  capacity: number | null;
  departure_date: string | null;
  is_active: boolean;
}

export type ValidatedGroup =
  | { ok: true; value: GroupInput }
  | { ok: false; error: string };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
  );
}

/** Validate a full create payload. */
export function validateGroupInput(
  body: Record<string, unknown>
): ValidatedGroup {
  if (!isGroupKind(body.kind)) {
    return { ok: false, error: 'kind must be "group" or "channel"' };
  }
  const kind = body.kind;

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return { ok: false, error: 'Give it a name' };
  if (name.length > MAX_NAME_LENGTH) {
    return {
      ok: false,
      error: `Keep the name under ${MAX_NAME_LENGTH} characters`,
    };
  }

  const url = validateInviteUrl(kind, body.invite_url);
  if (!url.ok) return url;

  const description =
    typeof body.description === 'string' ? body.description.trim() : '';
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return {
      ok: false,
      error: `Keep the description under ${MAX_DESCRIPTION_LENGTH} characters`,
    };
  }

  let capacity: number | null = null;
  if (
    body.capacity !== null &&
    body.capacity !== undefined &&
    body.capacity !== ''
  ) {
    const n = Number(body.capacity);
    if (!Number.isInteger(n) || n < 1 || n > MAX_CAPACITY) {
      return {
        ok: false,
        error: `Capacity must be a whole number from 1 to ${MAX_CAPACITY}`,
      };
    }
    capacity = n;
  }

  let departure: string | null = null;
  if (typeof body.departure_date === 'string' && body.departure_date.trim()) {
    departure = body.departure_date.trim();
    if (!isRealDate(departure)) {
      return { ok: false, error: 'Departure date must look like 2026-12-31' };
    }
  }
  // Channels are not tied to a departure or a size limit.
  if (kind === 'channel') {
    capacity = null;
    departure = null;
  }

  if (body.is_active !== undefined && typeof body.is_active !== 'boolean') {
    return { ok: false, error: 'is_active must be true or false' };
  }

  return {
    ok: true,
    value: {
      kind,
      name,
      invite_url: url.url,
      description: description || null,
      capacity,
      departure_date: departure,
      is_active: body.is_active !== false,
    },
  };
}

export type GroupDraft = Omit<GroupInput, 'invite_url'> & { invite_url: null };
export type ValidatedGroupDraft =
  | { ok: true; value: GroupDraft }
  | { ok: false; error: string };

/**
 * A group that is about to be created on WhatsApp, so it has no invite link yet (the link arrives from
 * Meta once the group exists). Same checks as a full group; only groups, never channels.
 */
export function validateGroupDraft(
  body: Record<string, unknown>
): ValidatedGroupDraft {
  const checked = validateGroupInput({
    ...body,
    kind: 'group',
    invite_url: 'https://chat.whatsapp.com/pending',
  });
  if (!checked.ok) return checked;
  return { ok: true, value: { ...checked.value, invite_url: null } };
}
