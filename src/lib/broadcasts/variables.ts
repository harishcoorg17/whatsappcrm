import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact, MessageTemplate } from '@/types';
import type { SendTimeParams } from '@/lib/whatsapp/template-send-builder';

/**
 * Variable mapping — each template placeholder (by key, usually "1",
 * "2", …) is resolved at send time. `field` maps to a built-in contact
 * field (name/phone/email/company); `custom_field` maps to a
 * contact_custom_values.value row keyed by the custom_fields.id stored
 * in `value`.
 */
export type VariableMapping =
  | { type: 'static'; value: string }
  | { type: 'field'; value: string }
  | { type: 'custom_field'; value: string };

/** contactId → (customFieldId → value). */
export type CustomValueIndex = Map<string, Map<string, string>>;

function resolveSingleValue(
  v: VariableMapping | undefined,
  contact: Contact,
  customValues?: Map<string, string>,
): string {
  if (!v || !v.value?.trim()) return '';
  if (v.type === 'static') return v.value;
  if (v.type === 'field') {
    const fieldMap: Record<string, string | undefined> = {
      name: contact.name,
      phone: contact.phone,
      email: contact.email,
      company: contact.company,
    };
    return fieldMap[v.value] ?? '';
  }
  if (v.type === 'custom_field') {
    return customValues?.get(v.value) ?? '';
  }
  return '';
}

/**
 * Per-contact resolution of custom-field placeholders. Static and
 * built-in-field mappings resolve synchronously; custom fields read
 * from a pre-built index to avoid N+1 queries during the send loop.
 */
export function resolveVariables(
  variables: Record<string, VariableMapping>,
  contact: Contact,
  customValues?: Map<string, string>,
): string[] {
  // Keys are typically "1","2",... — numeric-aware sort keeps
  // {{1}} before {{10}}.
  const keys = Object.keys(variables)
    .filter((k) => /^\d+$/.test(k))
    .sort((a, b) => Number(a) - Number(b));

  return keys.map((key) => resolveSingleValue(variables[key], contact, customValues));
}

export function resolveSendTimeParams(
  variables: Record<string, VariableMapping>,
  template: MessageTemplate,
  contact: Contact,
  customValues?: Map<string, string>,
): SendTimeParams {
  const body = resolveVariables(variables, contact, customValues);

  let headerText: string | undefined = undefined;
  const headerMapping = variables['header_1'] ?? variables['headerText'];
  if (headerMapping) {
    const val = resolveSingleValue(headerMapping, contact, customValues);
    if (val) headerText = val;
  }

  let headerMediaUrl: string | undefined = undefined;
  const mediaMapping = variables['header_media'];
  if (mediaMapping) {
    const val = resolveSingleValue(mediaMapping, contact, customValues);
    if (val) headerMediaUrl = val;
  }

  const buttonParams: Record<number, string> = {};
  (template.buttons ?? []).forEach((btn, i) => {
    const key = `button_${i}`;
    const btnMapping = variables[key];
    if (btnMapping) {
      const val = resolveSingleValue(btnMapping, contact, customValues);
      if (val) buttonParams[i] = val;
    }
  });

  return {
    body: body.length > 0 ? body : undefined,
    headerText,
    headerMediaUrl,
    buttonParams: Object.keys(buttonParams).length > 0 ? buttonParams : undefined,
  };
}

/**
 * Bulk-fetch contact_custom_values for a set of contacts. Returns an
 * index keyed by contact_id → field_id → value.
 */
export async function fetchCustomValueIndex(
  supabase: SupabaseClient,
  contactIds: string[],
): Promise<CustomValueIndex> {
  const index: CustomValueIndex = new Map();
  if (contactIds.length === 0) return index;

  // Supabase PostgREST caps the .in(...) IN-clause roughly at 1000
  // values. Page through to stay safe.
  const PAGE = 500;
  for (let i = 0; i < contactIds.length; i += PAGE) {
    const slice = contactIds.slice(i, i + PAGE);
    const { data } = await supabase
      .from('contact_custom_values')
      .select('contact_id, custom_field_id, value')
      .in('contact_id', slice);

    for (const row of data ?? []) {
      const bucket = index.get(row.contact_id) ?? new Map<string, string>();
      bucket.set(row.custom_field_id, row.value ?? '');
      index.set(row.contact_id, bucket);
    }
  }
  return index;
}
