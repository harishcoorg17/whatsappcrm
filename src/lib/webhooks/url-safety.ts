import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Webhook URLs are supplied by tenants and fetched by OUR server, so they must
 * not be able to reach our internal network (SSRF): only public https
 * addresses are allowed, checked when the endpoint is saved AND again right
 * before each delivery (DNS can change in between).
 *
 * For local development only, set WEBHOOKS_ALLOW_PRIVATE=true (ignored in
 * production) to allow http and private addresses such as http://localhost.
 */

export type UrlCheck = { ok: true; url: URL } | { ok: false; error: string };
export type Resolver = (
  hostname: string
) => Promise<Array<{ address: string; family: number }>>;

export const MAX_URL_LENGTH = 2000;

function parseIPv4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return octets.every((o) => o >= 0 && o <= 255) ? octets : null;
}

/** True for loopback, private, link-local, CGNAT, multicast and other non-public IPs. */
export function isPrivateAddress(ip: string): boolean {
  const lower = ip.toLowerCase();

  const v4 = parseIPv4(lower);
  if (v4) {
    const [a, b] = v4;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && v4[2] === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }

  if (isIP(lower) === 6) {
    // IPv4-mapped (::ffff:a.b.c.d) takes the IPv4 rules.
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
    if (mapped) return isPrivateAddress(mapped[1]);
    return (
      lower === '::' ||
      lower === '::1' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      /^fe[89ab]/.test(lower) ||
      lower.startsWith('ff')
    );
  }

  // Not a valid IP: treat as unsafe.
  return true;
}

export function allowPrivateTargets(): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.WEBHOOKS_ALLOW_PRIVATE === 'true'
  );
}

/** Check the shape of a URL without touching the network. */
export function validateWebhookUrlShape(
  raw: string,
  allowPrivate: boolean = allowPrivateTargets()
): UrlCheck {
  if (
    typeof raw !== 'string' ||
    raw.length === 0 ||
    raw.length > MAX_URL_LENGTH
  ) {
    return { ok: false, error: 'Enter a webhook URL' };
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, error: 'That is not a valid URL' };
  }
  if (
    url.protocol !== 'https:' &&
    !(allowPrivate && url.protocol === 'http:')
  ) {
    return { ok: false, error: 'The URL must start with https://' };
  }
  if (url.username || url.password) {
    return {
      ok: false,
      error: 'Remove the username and password from the URL',
    };
  }
  if (!allowPrivate) {
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      return {
        ok: false,
        error: 'That address is not reachable from the internet',
      };
    }
    if (isIP(host) !== 0 && isPrivateAddress(host)) {
      return {
        ok: false,
        error: 'That address is not reachable from the internet',
      };
    }
  }
  return { ok: true, url };
}

const defaultResolver: Resolver = (hostname) => lookup(hostname, { all: true });

/** Shape check plus a DNS check: every address the host resolves to must be public. */
export async function assertSafeWebhookUrl(
  raw: string,
  options: { resolver?: Resolver; allowPrivate?: boolean } = {}
): Promise<UrlCheck> {
  const allowPrivate = options.allowPrivate ?? allowPrivateTargets();
  const shape = validateWebhookUrlShape(raw, allowPrivate);
  if (!shape.ok || allowPrivate) return shape;

  const host = shape.url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) !== 0) return shape; // already checked as a literal

  try {
    const addresses = await (options.resolver ?? defaultResolver)(host);
    if (addresses.length === 0) {
      return { ok: false, error: 'That hostname does not resolve' };
    }
    if (addresses.some((a) => isPrivateAddress(a.address))) {
      return {
        ok: false,
        error: 'That address is not reachable from the internet',
      };
    }
    return shape;
  } catch {
    return { ok: false, error: 'That hostname does not resolve' };
  }
}
