/**
 * Rules for a tenant's backend API base URL (`crm_tenants.data_api_url`).
 *
 * The CRM server calls this address on behalf of flows, so it must never be
 * steerable at internal services. These checks run when the URL is saved and
 * again (via the DNS guard) every time a flow uses it.
 *
 * Pure and dependency-free so it is safe to import from client code.
 */

export type DataApiUrlResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

const BLOCKED_SUFFIXES = [
  '.local',
  '.localhost',
  '.internal',
  '.localdomain',
  '.lan',
  '.home',
  '.corp',
];
const HOST_PATTERN =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function fail(error: string): DataApiUrlResult {
  return { ok: false, error };
}

/** Validates and normalises a tenant API base: https, public name, no extras. */
export function normalizeDataApiUrl(input: string): DataApiUrlResult {
  const trimmed = input.trim();
  if (!trimmed) return fail('Enter the API address.');
  if (!/^https:\/\//i.test(trimmed)) {
    return fail('The API address must start with https://');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return fail('That is not a valid URL.');
  }

  if (parsed.username || parsed.password) {
    return fail('Do not put a username or password in the address.');
  }
  if (parsed.port) return fail('Custom ports are not allowed.');
  if (parsed.search || parsed.hash) {
    return fail('Leave out ?query and #fragment parts.');
  }

  const host = parsed.hostname.toLowerCase();
  if (host.startsWith('[') || IPV4_PATTERN.test(host)) {
    return fail('Use a domain name, not an IP address.');
  }
  if (
    host === 'localhost' ||
    BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix)) ||
    !HOST_PATTERN.test(host)
  ) {
    return fail('That host name is not allowed.');
  }

  const path = parsed.pathname.replace(/\/+$/, '');
  return { ok: true, url: `https://${host}${path}` };
}

function isPublicIpv4(a: number, b: number, c: number): boolean {
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a >= 224) return false; // multicast and reserved
  return true;
}

/** True only for addresses that are routable on the public internet. */
export function isPublicIp(ip: string): boolean {
  const v4 = IPV4_PATTERN.exec(ip);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    if ([a, b, c, d].some((part) => part > 255)) return false;
    return isPublicIpv4(a, b, c);
  }
  if (!ip.includes(':')) return false;

  const v6 = ip.toLowerCase();
  if (v6 === '::' || v6 === '::1') return false;

  const mappedDotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(v6);
  if (mappedDotted) return isPublicIp(mappedDotted[1]);
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v6);
  if (mappedHex) {
    const high = parseInt(mappedHex[1], 16);
    const low = parseInt(mappedHex[2], 16);
    return isPublicIpv4(high >> 8, high & 0xff, low >> 8);
  }

  if (/^fe[89ab]/.test(v6)) return false; // link-local fe80::/10
  if (/^f[cd]/.test(v6)) return false; // unique local fc00::/7
  if (v6.startsWith('ff')) return false; // multicast
  return true;
}
