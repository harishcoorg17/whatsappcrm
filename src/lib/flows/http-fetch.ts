/**
 * Guarded HTTP fetch for the `http_fetch` flow node.
 *
 * Flow authors are tenant users, and part of the URL can come from a
 * customer's reply, so this is written to fail closed:
 *   - https only, no credentials, no explicit port;
 *   - the host is either the tenant's own API (`{{api}}/…`, resolved from
 *     `crm_tenants.data_api_url`) or on an operator-controlled allow-list
 *     (FLOWS_HTTP_FETCH_ALLOWED_HOSTS), and can never contain a placeholder;
 *   - an optional host guard rejects names that resolve to private addresses;
 *   - substituted variables are URL-encoded;
 *   - GET only, redirects are not followed, short timeout, response size cap;
 *   - item fields are read through own properties only.
 * Every failure becomes `{ ok: false, reason }` so the engine can take the
 * node's failure branch instead of stranding the customer.
 */

import type { HttpFetchNodeConfig } from './types';

export type HttpFetchConfig = HttpFetchNodeConfig;

export type HttpFetchResult =
  | { ok: true; vars: Record<string, string | number> }
  | { ok: false; reason: string };

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_BYTES = 256 * 1024;
const DEFAULT_MAX_ITEMS = 5;
const HARD_MAX_ITEMS = 10;
export const MAX_CAPTURES = 5;
const VAR_KEY_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
// WhatsApp text bodies cap at 4096 characters; leave room for surrounding copy.
const MAX_RENDERED_CHARS = 3_500;

const VARS_PLACEHOLDER = /\{\{vars\.([a-zA-Z0-9_]+)\}\}/g;
const ITEM_PLACEHOLDER = /\{\{item\.([a-zA-Z0-9_.]+)\}\}/g;
const HOST_PATTERN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

export function parseAllowedHosts(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * The host of an https URL template, or null when the template is not a plain
 * https URL (other scheme, credentials, port, or a placeholder in the host).
 */
export function hostFromTemplate(template: string): string | null {
  const match = /^https:\/\/([^/?#]*)/i.exec(template.trim());
  if (!match) return null;
  const host = match[1].toLowerCase();
  if (!host || !HOST_PATTERN.test(host)) return null;
  return host;
}

/** Placeholder that stands for the tenant's own API base (`data_api_url`). */
export const API_BASE_PLACEHOLDER = '{{api}}';

/** True when the URL template is `{{api}}/path…`, resolved per tenant at run time. */
export function isApiBaseTemplate(template: string): boolean {
  return template.trim().startsWith(`${API_BASE_PLACEHOLDER}/`);
}

export function buildFetchUrl(
  template: string,
  vars: Record<string, unknown>
): string {
  return template.trim().replace(VARS_PLACEHOLDER, (_, key: string) => {
    const value = vars[key];
    return encodeURIComponent(
      value === undefined || value === null ? '' : String(value)
    );
  });
}

export function getByPath(source: unknown, path: string): unknown {
  if (!path) return source;
  let current: unknown = source;
  for (const segment of path.split('.')) {
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) return undefined;
      current = current[Number(segment)];
    } else if (current !== null && typeof current === 'object') {
      if (!Object.prototype.hasOwnProperty.call(current, segment)) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function asDisplayText(value: unknown): string {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  return '';
}

/**
 * Fills `{{item.field}}` placeholders from one item, line by line. A line whose
 * fields are ALL empty is left out, so a missing "Best time" never shows as a
 * bare label. Lines with no fields at all (spacing) and lines with at least
 * one filled field are kept as written.
 */
function renderTemplate(template: string, item: unknown): string {
  return template
    .split('\n')
    .map((line) => {
      let fields = 0;
      let filled = 0;
      const rendered = line.replace(ITEM_PLACEHOLDER, (_, path: string) => {
        const value = asDisplayText(getByPath(item, path));
        fields += 1;
        if (value !== '') filled += 1;
        return value;
      });
      return fields > 0 && filled === 0 ? null : rendered;
    })
    .filter((line): line is string => line !== null)
    .join('\n');
}

export function renderItems(
  body: unknown,
  config: Pick<
    HttpFetchConfig,
    'items_path' | 'item_template' | 'max_items' | 'empty_text'
  >
): { text: string; count: number } {
  const items = getByPath(body, config.items_path ?? '');
  if (!Array.isArray(items) || items.length === 0) {
    return { text: config.empty_text, count: 0 };
  }
  const limit = Math.min(
    Math.max(Math.floor(config.max_items ?? DEFAULT_MAX_ITEMS), 1),
    HARD_MAX_ITEMS
  );
  const lines = items
    .slice(0, limit)
    .map((item) => renderTemplate(config.item_template, item));
  return {
    text: lines.join('\n').slice(0, MAX_RENDERED_CHARS),
    count: lines.length,
  };
}

/**
 * Values of `capture` fields from the first item, as strings. When there is no
 * first item every captured variable is set to '' so a stale value from an
 * earlier lookup can never be reused by mistake.
 */
export function captureFromFirstItem(
  body: unknown,
  config: Pick<HttpFetchConfig, 'items_path' | 'capture'>
): Record<string, string> {
  const items = getByPath(body, config.items_path ?? '');
  const first = Array.isArray(items) ? items[0] : undefined;
  const captured: Record<string, string> = {};
  const entries = Object.entries(config.capture ?? {})
    .filter(([key]) => VAR_KEY_PATTERN.test(key))
    .slice(0, MAX_CAPTURES);
  for (const [key, path] of entries) {
    captured[key] =
      first === undefined ? '' : asDisplayText(getByPath(first, path));
  }
  return captured;
}

/** Reads a body up to `maxBytes`; null means it was larger than allowed. */
async function readCapped(
  res: Response,
  maxBytes: number
): Promise<string | null> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export async function runHttpFetch(params: {
  config: HttpFetchConfig;
  vars: Record<string, unknown>;
  /** Hosts allowed for absolute URLs (operator setting). */
  allowedHosts: string[];
  /** The tenant's API base (`data_api_url`), used to resolve `{{api}}/…` URLs. */
  apiBase?: string | null;
  /** Server-side check that a host resolves to public addresses only. */
  hostGuard?: (host: string) => Promise<boolean>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}): Promise<HttpFetchResult> {
  const {
    config,
    vars,
    allowedHosts,
    apiBase = null,
    hostGuard,
    fetchImpl = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
  } = params;

  const template = config.url.trim();
  let host: string | null;
  let url: string;
  if (isApiBaseTemplate(template)) {
    if (!apiBase) return { ok: false, reason: 'no_api_configured' };
    host = hostFromTemplate(apiBase);
    if (!host) return { ok: false, reason: 'invalid_api_base' };
    // Only the part after {{api}} takes variables, so nothing a customer
    // types (or a tenant puts in the base path) can rewrite the base itself.
    url =
      apiBase.replace(/\/+$/, '') +
      buildFetchUrl(template.slice(API_BASE_PLACEHOLDER.length), vars);
  } else {
    host = hostFromTemplate(template);
    if (!host || !allowedHosts.includes(host)) {
      return { ok: false, reason: 'host_not_allowed' };
    }
    url = buildFetchUrl(template, vars);
  }

  try {
    if (new URL(url).hostname.toLowerCase() !== host) {
      return { ok: false, reason: 'host_not_allowed' };
    }
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }

  if (hostGuard && !(await hostGuard(host))) {
    return { ok: false, reason: 'host_not_public' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (res.status < 200 || res.status > 299) {
      return { ok: false, reason: `bad_status_${res.status}` };
    }
    const raw = await readCapped(res, maxBytes);
    if (raw === null) return { ok: false, reason: 'response_too_large' };

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, reason: 'invalid_json' };
    }

    const { text, count } = renderItems(parsed, config);
    return {
      ok: true,
      // Captures first: the rendered text and count always win a name clash.
      vars: {
        ...captureFromFirstItem(parsed, config),
        [config.save_as]: text,
        [`${config.save_as}_count`]: count,
      },
    };
  } catch {
    return { ok: false, reason: 'request_failed' };
  } finally {
    clearTimeout(timer);
  }
}
