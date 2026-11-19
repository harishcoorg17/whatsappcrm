/**
 * Server-to-server "a traveller asked for a quote" for the integration API.
 *
 * The caller (the Amstago backend) sends the enquiry and its OWN `reference`
 * (the enquiry id). The CRM:
 *   1. answers a repeated reference with the deal it already made;
 *   2. finds or creates the traveller as a contact for the tenant;
 *   3. finds or creates the pipeline ("Quote requests" unless named) and its stage;
 *   4. adds a deal with the trip details in its notes, linked to the conversation
 *      when the traveller already has one.
 *
 * Pipelines and deals belong to the owner user (as in the pipelines screen);
 * contacts and conversations are scoped to the tenant (as in the inbox).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { phonesMatch, sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';
import type { AuthenticatedKey } from './api-key';

const DEFAULT_PIPELINE = 'Quote requests';
const DEFAULT_STAGE = 'New';
const DEFAULT_STAGES = ['New', 'Contacted', 'Quote sent', 'Won', 'Lost'] as const;
const REFERENCE = /^[A-Za-z0-9-]{1,64}$/;
const MIN_PHONE_DIGITS = 8;
const MAX_PHONE_DIGITS = 15;
const MAX_NAME_LENGTH = 120;
const MAX_EMAIL_LENGTH = 200;
const MAX_TITLE_LENGTH = 200;
const MAX_LABEL_LENGTH = 60;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_ADULTS = 200;
const MAX_CHILDREN = 50;
const MAX_CHILD_AGE = 17;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY = 'INR';

export interface EnquiryInput {
  reference: string;
  name: string;
  phone: string;
  email?: string;
  tourTitle: string;
  adults: number;
  childAges: number[];
  travelDate?: string;
  message?: string;
  /** Per-person starting price the traveller was shown. */
  startingPrice?: number;
  source: string;
  pipelineName: string;
  stageName: string;
}

export type ParseResult =
  | { ok: true; value: EnquiryInput }
  | { ok: false; error: string };

const fail = (error: string): ParseResult => ({ ok: false, error });
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function parseEnquiryBody(raw: unknown): ParseResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return fail('Body must be a JSON object.');
  }
  const b = raw as Record<string, unknown>;

  const reference = text(b.reference);
  if (!REFERENCE.test(reference)) {
    return fail('"reference" is required: letters, digits and hyphens, up to 64 characters.');
  }

  const name = text(b.name);
  if (!name || name.length > MAX_NAME_LENGTH) return fail('"name" is required.');

  const phone = sanitizePhoneForMeta(text(b.phone));
  if (phone.length < MIN_PHONE_DIGITS || phone.length > MAX_PHONE_DIGITS) {
    return fail('"phone" is required, with the country code.');
  }

  const email = text(b.email);
  if (email.length > MAX_EMAIL_LENGTH) return fail('"email" is too long.');

  const tourTitle = text(b.tour_title);
  if (!tourTitle || tourTitle.length > MAX_TITLE_LENGTH) return fail('"tour_title" is required.');

  const adults = b.adults === undefined ? 2 : Number(b.adults);
  if (!Number.isInteger(adults) || adults < 1 || adults > MAX_ADULTS) {
    return fail('"adults" must be a whole number of at least 1.');
  }

  const childAges: number[] = [];
  if (b.children !== undefined && b.children !== null) {
    if (!Array.isArray(b.children) || b.children.length > MAX_CHILDREN) {
      return fail('"children" must be a list of ages.');
    }
    for (const c of b.children) {
      const age = Number(typeof c === 'object' && c !== null ? (c as { age?: unknown }).age : c);
      if (!Number.isInteger(age) || age < 0 || age > MAX_CHILD_AGE) {
        return fail('Each child age must be between 0 and 17.');
      }
      childAges.push(age);
    }
  }

  const travelDate = text(b.travel_date);
  if (travelDate && !DATE_ONLY.test(travelDate)) return fail('"travel_date" must be YYYY-MM-DD.');

  const message = text(b.message);
  if (message.length > MAX_MESSAGE_LENGTH) return fail('"message" is too long.');

  let startingPrice: number | undefined;
  if (b.starting_price !== undefined && b.starting_price !== null) {
    startingPrice = Number(b.starting_price);
    if (!Number.isFinite(startingPrice) || startingPrice < 0) {
      return fail('"starting_price" must be a positive number.');
    }
  }

  const pipelineName = text(b.pipeline_name) || DEFAULT_PIPELINE;
  const stageName = text(b.stage_name) || DEFAULT_STAGE;
  if (pipelineName.length > MAX_LABEL_LENGTH || stageName.length > MAX_LABEL_LENGTH) {
    return fail('"pipeline_name" and "stage_name" are limited to 60 characters.');
  }

  return {
    ok: true,
    value: {
      reference,
      name,
      phone,
      email: email || undefined,
      tourTitle,
      adults,
      childAges,
      travelDate: travelDate || undefined,
      message: message || undefined,
      startingPrice,
      source: text(b.source).slice(0, MAX_LABEL_LENGTH) || 'tour_page',
      pipelineName,
      stageName,
    },
  };
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function describeGroup(adults: number, childAges: number[]): string {
  const base = plural(adults, 'adult', 'adults');
  if (childAges.length === 0) return base;
  return `${base} + ${plural(childAges.length, 'kid', 'kids')} (ages ${childAges.join(', ')})`;
}

export const referenceMarker = (reference: string): string => `[ref:${reference}]`;

export function buildDealTitle(input: EnquiryInput): string {
  return `${input.name} — ${input.tourTitle}`.slice(0, MAX_TITLE_LENGTH);
}

/** Indicative value: the per-person starting price for the whole adult group. */
export function estimateDealValue(input: EnquiryInput): number {
  return input.startingPrice ? Math.round(input.startingPrice * input.adults) : 0;
}

export function buildDealNotes(input: EnquiryInput): string {
  const lines = [
    `Tour: ${input.tourTitle}`,
    `Group: ${describeGroup(input.adults, input.childAges)}`,
    `Travel date: ${input.travelDate ?? 'Flexible'}`,
    input.email ? `Email: ${input.email}` : null,
    input.startingPrice
      ? `Starting price shown: ₹${input.startingPrice.toLocaleString('en-IN')} per person (based on 2 adults)`
      : null,
    input.message ? `Message: ${input.message}` : null,
    `Source: ${input.source}`,
    referenceMarker(input.reference),
  ];
  return lines.filter((l): l is string => l !== null).join('\n');
}

export type EnquiryDealResult =
  | { ok: true; status: 'created' | 'duplicate'; dealId: string; contactId: string; pipelineId: string }
  | { ok: false; code: string; message: string; httpStatus: number };

const failure = (code: string, message: string, httpStatus: number): EnquiryDealResult => ({
  ok: false,
  code,
  message,
  httpStatus,
});

interface IdRow {
  id: string;
}

async function findOrCreateContact(
  db: SupabaseClient,
  auth: AuthenticatedKey,
  input: EnquiryInput
): Promise<string> {
  const { data: contacts } = await db
    .from('contacts')
    .select('id, phone, email')
    .eq('user_id', auth.ownerUserId)
    .eq('tenant_id', auth.tenantId);

  const existing = (contacts as Array<{ id: string; phone: string; email: string | null }> | null)?.find(
    (c) => phonesMatch(c.phone, input.phone)
  );
  if (existing) {
    if (!existing.email && input.email) {
      await db.from('contacts').update({ email: input.email }).eq('id', existing.id);
    }
    return existing.id;
  }

  const { data: created, error } = await db
    .from('contacts')
    .insert({
      user_id: auth.ownerUserId,
      tenant_id: auth.tenantId,
      phone: input.phone,
      name: input.name,
      ...(input.email ? { email: input.email } : {}),
    })
    .select('id')
    .single();
  if (error || !created) throw new Error(`could not create contact: ${error?.message ?? 'no row'}`);
  return (created as IdRow).id;
}

async function findOrCreatePipeline(
  db: SupabaseClient,
  auth: AuthenticatedKey,
  input: EnquiryInput
): Promise<{ pipelineId: string; stageId: string }> {
  const { data: pipelines } = await db
    .from('pipelines')
    .select('id, created_at')
    .eq('user_id', auth.ownerUserId)
    .eq('name', input.pipelineName);

  let pipelineId = ((pipelines as Array<IdRow & { created_at?: string }> | null) ?? [])
    .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))[0]?.id;

  if (!pipelineId) {
    const { data: created, error } = await db
      .from('pipelines')
      .insert({ user_id: auth.ownerUserId, name: input.pipelineName })
      .select('id')
      .single();
    if (error || !created) throw new Error(`could not create pipeline: ${error?.message ?? 'no row'}`);
    pipelineId = (created as IdRow).id;

    const { error: stagesError } = await db.from('pipeline_stages').insert(
      DEFAULT_STAGES.map((name, position) => ({ pipeline_id: pipelineId, name, position }))
    );
    if (stagesError) throw new Error(`could not create stages: ${stagesError.message}`);
  }

  const { data: stages } = await db
    .from('pipeline_stages')
    .select('id, name, position')
    .eq('pipeline_id', pipelineId);
  const ordered = ((stages as Array<IdRow & { name: string; position: number }> | null) ?? []).sort(
    (a, b) => a.position - b.position
  );
  const stage =
    ordered.find((s) => s.name.toLowerCase() === input.stageName.toLowerCase()) ?? ordered[0];
  if (!stage) throw new Error('pipeline has no stages');
  return { pipelineId, stageId: stage.id };
}

export async function executeEnquiryDeal(args: {
  db: SupabaseClient;
  auth: AuthenticatedKey;
  input: EnquiryInput;
}): Promise<EnquiryDealResult> {
  const { db, auth, input } = args;

  try {
    // 1. A repeated reference returns the deal made the first time.
    const { data: earlier } = await db
      .from('deals')
      .select('id, pipeline_id, contact_id')
      .eq('user_id', auth.ownerUserId)
      .ilike('notes', `%${referenceMarker(input.reference)}%`)
      .maybeSingle();
    if (earlier) {
      const row = earlier as { id: string; pipeline_id: string; contact_id: string };
      return { ok: true, status: 'duplicate', dealId: row.id, contactId: row.contact_id, pipelineId: row.pipeline_id };
    }

    // 2. Contact, 3. pipeline + stage.
    const contactId = await findOrCreateContact(db, auth, input);
    const { pipelineId, stageId } = await findOrCreatePipeline(db, auth, input);

    // Link the deal to the traveller's inbox conversation when there already is one.
    const { data: conversation } = await db
      .from('conversations')
      .select('id')
      .eq('user_id', auth.ownerUserId)
      .eq('tenant_id', auth.tenantId)
      .eq('contact_id', contactId)
      .maybeSingle();

    // 4. The deal.
    const { data: deal, error } = await db
      .from('deals')
      .insert({
        user_id: auth.ownerUserId,
        pipeline_id: pipelineId,
        stage_id: stageId,
        contact_id: contactId,
        conversation_id: (conversation as IdRow | null)?.id ?? null,
        title: buildDealTitle(input),
        value: estimateDealValue(input),
        currency: CURRENCY,
        notes: buildDealNotes(input),
        status: 'open',
      })
      .select('id')
      .single();
    if (error || !deal) {
      return failure('deal_failed', `Could not create the deal: ${error?.message ?? 'no row'}`, 500);
    }
    return { ok: true, status: 'created', dealId: (deal as IdRow).id, contactId, pipelineId };
  } catch (err) {
    return failure('internal_error', err instanceof Error ? err.message : 'Could not create the deal.', 500);
  }
}
