/**
 * Click-to-WhatsApp ad attribution. When a customer opens a chat by tapping a
 * Meta ad, the first inbound message carries a `referral` object. This module
 * parses it into a clean shape and provides the pure helpers the rest of the
 * app uses (labels, tag names, automation matching). No I/O lives here.
 */

export interface AdReferral {
  /** Meta ad (or post) id. */
  sourceId: string;
  /** "ad" or "post". */
  sourceType: string | null;
  sourceUrl: string | null;
  headline: string | null;
  body: string | null;
  /** Click id Meta wants echoed back for conversion reporting. */
  ctwaClid: string | null;
  /** Thumbnail / image / video url of the ad creative. */
  mediaUrl: string | null;
}

const MAX_TEXT = 500;
const MAX_TAG_LABEL = 40;

const text = (value: unknown, max = MAX_TEXT): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

/** Only http(s) links are kept; anything else could be rendered as a javascript: href. */
const httpUrl = (value: unknown): string | null => {
  const raw = text(value, 2000);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? raw : null;
  } catch {
    return null;
  }
};

/** Parse Meta's `referral` object; null when it is absent or has no source id. */
export function parseReferral(raw: unknown): AdReferral | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const sourceId = text(r.source_id, 100);
  if (!sourceId) return null;
  return {
    sourceId,
    sourceType: text(r.source_type, 20)?.toLowerCase() ?? null,
    sourceUrl: httpUrl(r.source_url),
    headline: text(r.headline),
    body: text(r.body),
    ctwaClid: text(r.ctwa_clid, 500),
    mediaUrl:
      httpUrl(r.image_url) ?? httpUrl(r.video_url) ?? httpUrl(r.thumbnail_url),
  };
}

/** Human label for the ad: its headline, else "Ad <id>". */
export function adLabel(
  ad: Pick<AdReferral, 'headline' | 'sourceId' | 'sourceType'>
): string {
  if (ad.headline) return ad.headline;
  return `${ad.sourceType === 'post' ? 'Post' : 'Ad'} ${ad.sourceId}`;
}

/** Name of the tag put on a contact who arrived from this ad. */
export function adTagName(
  ad: Pick<AdReferral, 'headline' | 'sourceId' | 'sourceType'>
): string {
  const label = adLabel(ad);
  const short =
    label.length > MAX_TAG_LABEL ? `${label.slice(0, MAX_TAG_LABEL)}…` : label;
  return `Ad: ${short}`;
}

/**
 * Automation condition: does the conversation's ad match what the tenant typed?
 * The needle matches the exact ad id, or is contained in the headline / body
 * (case-insensitive). An empty needle matches any ad chat; no ad never matches.
 */
export function adMatches(
  ad: Pick<AdReferral, 'sourceId' | 'headline' | 'body'> | null,
  needle: string | null | undefined
): boolean {
  if (!ad) return false;
  const n = (needle ?? '').trim().toLowerCase();
  if (!n) return true;
  if (ad.sourceId.toLowerCase() === n) return true;
  return [ad.headline, ad.body].some((t) => t?.toLowerCase().includes(n));
}

/** Columns on `conversations` (migration 042) for an ad referral. */
export function referralToColumns(ad: AdReferral) {
  return {
    ad_source_id: ad.sourceId,
    ad_source_type: ad.sourceType,
    ad_source_url: ad.sourceUrl,
    ad_headline: ad.headline,
    ad_body: ad.body,
    ad_ctwa_clid: ad.ctwaClid,
    ad_media_url: ad.mediaUrl,
    ad_referred_at: new Date().toISOString(),
  };
}

/** Rebuild an AdReferral from a conversations row; null when none stored. */
export function referralFromRow(
  row: Record<string, unknown> | null | undefined
): AdReferral | null {
  if (!row || typeof row.ad_source_id !== 'string' || !row.ad_source_id)
    return null;
  const s = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return {
    sourceId: row.ad_source_id,
    sourceType: s(row.ad_source_type),
    sourceUrl: s(row.ad_source_url),
    headline: s(row.ad_headline),
    body: s(row.ad_body),
    ctwaClid: s(row.ad_ctwa_clid),
    mediaUrl: s(row.ad_media_url),
  };
}
