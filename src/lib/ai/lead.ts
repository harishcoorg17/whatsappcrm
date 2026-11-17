import type { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  LEAD_FIELDS,
  isLeadQualified,
  type LeadField,
  type LeadInfo,
} from './agent-core';

type AdminClient = ReturnType<typeof supabaseAdmin>;

/**
 * Saves the trip details the AI heard onto the contact, using the tenant's
 * ordinary custom fields and tags so they show up in the contact view,
 * segments and broadcast variables like any other field. Fields are created
 * on first use. Never throws: a failed save must not cost the customer a reply.
 */

export const LEAD_FIELD_LABELS: Record<LeadField, string> = {
  destination: 'Destination',
  travel_dates: 'Travel dates',
  group_size: 'Group size',
  budget: 'Budget',
};
export const LEAD_TAG_NAME = 'ai-lead';
const LEAD_TAG_COLOR = '#10b981';

export interface SaveLeadInput {
  db: AdminClient;
  userId: string;
  tenantId: string;
  contactId: string;
  lead: LeadInfo;
}

interface FieldRow {
  id: string;
  field_name: string;
}

async function ensureCustomFieldIds(
  db: AdminClient,
  userId: string,
  tenantId: string,
  fields: LeadField[]
): Promise<Map<LeadField, string>> {
  const names = fields.map((f) => LEAD_FIELD_LABELS[f]);
  const { data: existing } = await db
    .from('custom_fields')
    .select('id, field_name')
    .eq('user_id', userId)
    .in('field_name', names);

  const byName = new Map<string, string>(
    ((existing ?? []) as FieldRow[]).map((r) => [r.field_name, r.id])
  );

  const missing = names.filter((n) => !byName.has(n));
  if (missing.length > 0) {
    const { data: created, error } = await db
      .from('custom_fields')
      .insert(
        missing.map((field_name) => ({
          user_id: userId,
          tenant_id: tenantId,
          field_name,
          field_type: 'text',
        }))
      )
      .select('id, field_name');
    if (error) throw new Error(`custom field create: ${error.message}`);
    for (const row of (created ?? []) as FieldRow[]) {
      byName.set(row.field_name, row.id);
    }
  }

  const ids = new Map<LeadField, string>();
  for (const field of fields) {
    const id = byName.get(LEAD_FIELD_LABELS[field]);
    if (id) ids.set(field, id);
  }
  return ids;
}

/** Everything saved so far on this contact, across earlier messages. */
async function loadStoredLead(
  db: AdminClient,
  userId: string,
  contactId: string
): Promise<LeadInfo> {
  const { data: fieldRows } = await db
    .from('custom_fields')
    .select('id, field_name')
    .eq('user_id', userId)
    .in('field_name', Object.values(LEAD_FIELD_LABELS));
  const fieldByName = new Map<string, string>(
    ((fieldRows ?? []) as FieldRow[]).map((r) => [r.field_name, r.id])
  );

  const { data: valueRows } = await db
    .from('contact_custom_values')
    .select('custom_field_id, value')
    .eq('contact_id', contactId)
    .in('custom_field_id', [...fieldByName.values()]);
  const valueById = new Map<string, string>(
    (
      (valueRows ?? []) as Array<{
        custom_field_id: string;
        value: string | null;
      }>
    )
      .filter((r) => !!r.value)
      .map((r) => [r.custom_field_id, r.value as string])
  );

  const stored: LeadInfo = {};
  for (const field of LEAD_FIELDS) {
    const id = fieldByName.get(LEAD_FIELD_LABELS[field]);
    const value = id ? valueById.get(id) : undefined;
    if (value) stored[field] = value;
  }
  return stored;
}

async function tagContact(
  db: AdminClient,
  userId: string,
  tenantId: string,
  contactId: string
): Promise<void> {
  const { data: existing } = await db
    .from('tags')
    .select('id')
    .eq('user_id', userId)
    .eq('name', LEAD_TAG_NAME)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  let tagId = (existing as { id: string } | null)?.id ?? null;
  if (!tagId) {
    const { data: created, error } = await db
      .from('tags')
      .insert({
        user_id: userId,
        tenant_id: tenantId,
        name: LEAD_TAG_NAME,
        color: LEAD_TAG_COLOR,
      })
      .select('id')
      .single();
    if (error) throw new Error(`tag create: ${error.message}`);
    tagId = (created as { id: string }).id;
  }

  const { error } = await db
    .from('contact_tags')
    .upsert(
      { contact_id: contactId, tag_id: tagId },
      { onConflict: 'contact_id,tag_id' }
    );
  if (error) throw new Error(`tag contact: ${error.message}`);
}

export async function saveLead(input: SaveLeadInput): Promise<void> {
  const { db, userId, tenantId, contactId, lead } = input;
  try {
    const fields = LEAD_FIELDS.filter((f) => lead[f]);
    if (fields.length === 0) return;

    const ids = await ensureCustomFieldIds(db, userId, tenantId, fields);
    const rows = fields.flatMap((field) => {
      const customFieldId = ids.get(field);
      const value = lead[field];
      return customFieldId && value
        ? [
            {
              contact_id: contactId,
              custom_field_id: customFieldId,
              tenant_id: tenantId,
              value,
            },
          ]
        : [];
    });
    if (rows.length > 0) {
      const { error } = await db
        .from('contact_custom_values')
        .upsert(rows, { onConflict: 'contact_id,custom_field_id' });
      if (error) throw new Error(`save values: ${error.message}`);
    }

    // "Enough" is judged on everything the contact has told us so far, not
    // just this message.
    const stored = await loadStoredLead(db, userId, contactId);
    if (isLeadQualified({ ...stored, ...lead })) {
      await tagContact(db, userId, tenantId, contactId);
    }
  } catch (error) {
    console.error(
      '[ai-agent] could not save lead details:',
      error instanceof Error ? error.message : error
    );
  }
}
