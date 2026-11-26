/**
 * Server-to-server registration of a group trip as a pending WhatsApp group.
 * The invite link is added later, by hand, once the WhatsApp group exists.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  MAX_CAPACITY,
  MAX_DESCRIPTION_LENGTH,
  MAX_NAME_LENGTH,
} from '@/lib/whatsapp-groups/invite-url';

const MAX_REFERENCE_LENGTH = 128;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface GroupRegistration {
  reference: string;
  name: string;
  description: string | null;
  capacity: number | null;
  departureDate: string | null;
}

export type ParsedGroupRegistration =
  | { ok: true; value: GroupRegistration }
  | { ok: false; error: string };

function isRealDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

export function parseGroupRegistration(raw: unknown): ParsedGroupRegistration {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }
  const body = raw as Record<string, unknown>;

  const reference = typeof body.reference === 'string' ? body.reference.trim() : '';
  if (!reference || reference.length > MAX_REFERENCE_LENGTH) {
    return { ok: false, error: `reference is required (max ${MAX_REFERENCE_LENGTH} characters).` };
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `name is required (max ${MAX_NAME_LENGTH} characters).` };
  }

  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return { ok: false, error: `description must be under ${MAX_DESCRIPTION_LENGTH} characters.` };
  }

  let capacity: number | null = null;
  if (body.capacity !== undefined && body.capacity !== null) {
    const n = Number(body.capacity);
    if (!Number.isInteger(n) || n < 1 || n > MAX_CAPACITY) {
      return { ok: false, error: `capacity must be a whole number from 1 to ${MAX_CAPACITY}.` };
    }
    capacity = n;
  }

  let departureDate: string | null = null;
  if (body.departure_date !== undefined && body.departure_date !== null) {
    if (typeof body.departure_date !== 'string' || !isRealDate(body.departure_date)) {
      return { ok: false, error: 'departure_date must look like 2026-12-31.' };
    }
    departureDate = body.departure_date;
  }

  return {
    ok: true,
    value: { reference, name, description: description || null, capacity, departureDate },
  };
}

export type RegisterGroupResult =
  | { ok: true; status: 'created' | 'duplicate'; groupId: string }
  | { ok: false; message: string };

const UNIQUE_VIOLATION = '23505';

/** Adds the group for the tenant, or returns the existing one for a repeated reference. */
export async function registerPendingGroup(
  db: SupabaseClient,
  tenantId: string,
  input: GroupRegistration
): Promise<RegisterGroupResult> {
  const findExisting = async () => {
    const { data } = await db
      .from('whatsapp_groups')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('external_ref', input.reference)
      .maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  };

  const existing = await findExisting();
  if (existing) return { ok: true, status: 'duplicate', groupId: existing };

  const { data, error } = await db
    .from('whatsapp_groups')
    .insert({
      tenant_id: tenantId,
      kind: 'group',
      name: input.name,
      invite_url: null,
      description: input.description,
      capacity: input.capacity,
      departure_date: input.departureDate,
      external_ref: input.reference,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      const raced = await findExisting();
      if (raced) return { ok: true, status: 'duplicate', groupId: raced };
    }
    console.error('[integrations/groups] insert failed:', error.message);
    return { ok: false, message: 'Could not save the group.' };
  }
  return { ok: true, status: 'created', groupId: (data as { id: string }).id };
}
