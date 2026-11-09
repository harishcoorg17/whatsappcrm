/**
 * Single source of truth for the Meta Graph API version.
 *
 * Meta retires Graph versions roughly two years after release, so the version
 * must be changeable without a code edit. Set `META_GRAPH_VERSION` (server) or
 * `NEXT_PUBLIC_META_GRAPH_VERSION` (browser, used for `FB.init`).
 *
 * The default matches the latest version named in Meta's Embedded Signup
 * documentation at the time of writing.
 */

export const DEFAULT_GRAPH_VERSION = 'v27.0';

const GRAPH_VERSION_PATTERN = /^v\d+\.\d+$/;

export function resolveGraphVersion(
  serverValue: string | undefined,
  publicValue: string | undefined
): string {
  for (const candidate of [serverValue, publicValue]) {
    const trimmed = candidate?.trim();
    if (trimmed && GRAPH_VERSION_PATTERN.test(trimmed)) return trimmed;
  }
  return DEFAULT_GRAPH_VERSION;
}

export function graphBaseUrl(version: string): string {
  return `https://graph.facebook.com/${version}`;
}

export const GRAPH_VERSION = resolveGraphVersion(
  process.env.META_GRAPH_VERSION,
  process.env.NEXT_PUBLIC_META_GRAPH_VERSION
);

export const GRAPH_BASE_URL = graphBaseUrl(GRAPH_VERSION);
