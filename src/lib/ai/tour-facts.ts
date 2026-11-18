/**
 * Real details of the tour a customer asked about, as text for the AI.
 *
 * Fetches the tenant's public tour endpoint (`GET {api}/tours/<slug>/details`)
 * with the same guard rails as the other tenant-API calls: https only, a
 * public host, no redirects, a short timeout and a size cap. Any problem
 * returns null and the AI simply answers from the saved business information.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { hostFromTemplate, readCapped } from '@/lib/flows/http-fetch';
import { loadTenantApiBase, publicHostGuard } from '@/lib/flows/tenant-api';
import { findLatestTourEnquiry, titleToSlug } from './tour-enquiry';
import { isAiProvider } from './providers';

const TIMEOUT_MS = 5_000;
const MAX_BYTES = 256 * 1024;
export const MAX_TOUR_FACTS_CHARS = 6_000;
const MAX_ITINERARY_DAYS = 15;
const MAX_LIST_ITEMS = 12;
const MAX_DEPARTURES = 6;
const MAX_POLICY_CHARS = 500;

type Json = Record<string, unknown>;

const asObject = (value: unknown): Json | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : null;

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

const asText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const rupees = (amount: number): string =>
  `Rs ${Math.round(amount).toLocaleString('en-IN')}`;

const strings = (value: unknown, limit: number): string[] =>
  asArray(value)
    .map(asText)
    .filter((s): s is string => s !== null)
    .slice(0, limit);

function priceLines(variants: unknown): string[] {
  const lines: string[] = [];
  for (const raw of asArray(variants)) {
    const variant = asObject(raw);
    const price = asNumber(variant?.price_per_adult);
    if (!variant || !price || price <= 0) continue;
    const name = asText(variant.variant_type) ?? 'Standard';
    const discount = asNumber(variant.discount_price);
    const final =
      discount && discount > 0 && discount < price ? discount : price;
    lines.push(`- ${name}: ${rupees(final)} per adult`);
  }
  return lines;
}

function itineraryLines(itinerary: unknown): string[] {
  return asArray(itinerary)
    .slice(0, MAX_ITINERARY_DAYS)
    .map((raw, index) => {
      const day = asObject(raw);
      const title = asText(day?.day_title) ?? asText(day?.title);
      if (!title) return null;
      const highlights = strings(day?.highlights, 4);
      const detail = highlights.length ? `: ${highlights.join('; ')}` : '';
      return `- Day ${index + 1}: ${title}${detail}`;
    })
    .filter((line): line is string => line !== null);
}

function departureLines(dates: unknown): string[] {
  return asArray(dates)
    .map((raw) => {
      const departure = asObject(raw);
      const date = asText(departure?.date);
      if (!date || asText(departure?.status) === 'closed') return null;
      const slots = asNumber(departure?.slots);
      return slots !== null ? `${date} (${slots} slots left)` : date;
    })
    .filter((d): d is string => d !== null)
    .slice(0, MAX_DEPARTURES);
}

function section(title: string, lines: string[]): string[] {
  return lines.length ? ['', `${title}:`, ...lines] : [];
}

/** Turns the tour endpoint's response into a compact text block, or null. */
export function formatTourFacts(payload: unknown): string | null {
  const data = asObject(asObject(payload)?.data);
  const pkg = asObject(data?.package);
  const title = asText(pkg?.title);
  if (!data || !pkg || !title) return null;

  const days = asNumber(pkg.duration_days);
  const lines = [
    `The customer is asking about this tour: ${title}${days ? ` (${days} days)` : ''}.`,
  ];
  const summary = asText(pkg.short_description);
  if (summary) lines.push(summary);

  lines.push(...section('Prices', priceLines(data.variants)));
  lines.push(...section('Itinerary', itineraryLines(data.itinerary)));
  lines.push(
    ...section(
      'Included',
      strings(pkg.inclusions, MAX_LIST_ITEMS).map((i) => `- ${i}`)
    )
  );
  lines.push(
    ...section(
      'Not included',
      strings(pkg.exclusions, MAX_LIST_ITEMS).map((i) => `- ${i}`)
    )
  );
  const departures = departureLines(pkg.fixed_departure_dates);
  if (departures.length) {
    lines.push('', `Upcoming departures: ${departures.join(', ')}`);
  }
  const cancellation = asText(asObject(pkg.terms)?.cancellation_policy);
  if (cancellation) {
    lines.push(
      '',
      `Cancellation policy: ${cancellation.slice(0, MAX_POLICY_CHARS)}`
    );
  }
  return lines.join('\n').slice(0, MAX_TOUR_FACTS_CHARS);
}

export async function fetchTourFacts(params: {
  apiBase: string;
  title: string;
  fetchImpl?: typeof fetch;
  hostGuard?: (host: string) => Promise<boolean>;
}): Promise<string | null> {
  const { apiBase, title, fetchImpl = fetch, hostGuard } = params;
  const slug = titleToSlug(title);
  const host = hostFromTemplate(apiBase);
  if (!slug || !host) return null;
  if (hostGuard && !(await hostGuard(host))) return null;

  const url = `${apiBase.replace(/\/+$/, '')}/tours/${encodeURIComponent(slug)}/details`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (res.status < 200 || res.status > 299) return null;
    const raw = await readCapped(res, MAX_BYTES);
    return raw === null ? null : formatTourFacts(JSON.parse(raw));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Details of the tour named in the chat (newest enquiry wins), or null when
 * nobody asked about a tour, the tenant has no API, or the lookup fails.
 */
export async function loadTourKnowledge(params: {
  db: SupabaseClient;
  conversationId: string;
  customerTexts: ReadonlyArray<string | null | undefined>;
}): Promise<string | null> {
  const enquiry = findLatestTourEnquiry(params.customerTexts);
  if (!enquiry) return null;
  const apiBase = await loadTenantApiBase(params.db, params.conversationId);
  if (!apiBase) return null;
  return fetchTourFacts({
    apiBase,
    title: enquiry.title,
    hostGuard: publicHostGuard,
  });
}

/** True when the tenant switched the AI on and saved a provider and key. */
export async function isAiReady(
  db: SupabaseClient,
  tenantId: string
): Promise<boolean> {
  const { data } = await db
    .from('crm_tenants')
    .select('ai_enabled, ai_provider, ai_api_key_enc')
    .eq('id', tenantId)
    .maybeSingle();
  const row = data as {
    ai_enabled: boolean | null;
    ai_provider: string | null;
    ai_api_key_enc: string | null;
  } | null;
  return (
    !!row?.ai_enabled && isAiProvider(row.ai_provider) && !!row.ai_api_key_enc
  );
}
