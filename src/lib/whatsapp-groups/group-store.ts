/**
 * The few database operations the group-creation flow needs. The flow depends on
 * this interface, so it is tested with an in-memory store instead of a database.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type CreationStatus = 'manual' | 'creating' | 'active' | 'failed';

export interface GroupRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  invite_url: string | null;
  creation_status: CreationStatus;
  /** The caller's own id for the group (Amstago sends its tour id here). */
  external_ref: string | null;
  wa_request_id: string | null;
  wa_group_id: string | null;
  wa_phone_number_id: string | null;
}

export interface GroupPatch {
  invite_url?: string | null;
  creation_status?: CreationStatus;
  creation_error?: string | null;
  wa_request_id?: string | null;
  wa_group_id?: string | null;
  wa_phone_number_id?: string | null;
}

export interface GroupStore {
  /**
   * The group a Meta webhook belongs to, matched by request id, then group id. If Meta's create
   * response carried neither, the group still `creating` on that number with that name.
   */
  findByWa(ref: {
    requestId?: string | null;
    groupId?: string | null;
    subject?: string | null;
    phoneNumberId?: string | null;
  }): Promise<GroupRow | null>;
  update(id: string, patch: GroupPatch): Promise<boolean>;
  /** Marks already-invited people as joined or left. Returns how many invites changed. */
  setInviteStatus(
    group: GroupRow,
    waIds: string[],
    status: 'joined' | 'left'
  ): Promise<number>;
}

export const GROUP_COLUMNS =
  'id, tenant_id, name, description, invite_url, creation_status, external_ref, wa_request_id, wa_group_id, wa_phone_number_id';

const phoneVariants = (waId: string) => [waId, `+${waId}`];

export function supabaseGroupStore(db: SupabaseClient): GroupStore {
  const find = async (
    column: 'wa_request_id' | 'wa_group_id',
    value: string
  ) => {
    const { data } = await db
      .from('whatsapp_groups')
      .select(GROUP_COLUMNS)
      .eq(column, value)
      .maybeSingle();
    return (data as GroupRow | null) ?? null;
  };

  return {
    async findByWa({ requestId, groupId, subject, phoneNumberId }) {
      if (requestId) {
        const byRequest = await find('wa_request_id', requestId);
        if (byRequest) return byRequest;
      }
      if (groupId) {
        const byGroup = await find('wa_group_id', groupId);
        if (byGroup) return byGroup;
      }
      if (!subject || !phoneNumberId) return null;
      const { data } = await db
        .from('whatsapp_groups')
        .select(GROUP_COLUMNS)
        .eq('creation_status', 'creating')
        .eq('wa_phone_number_id', phoneNumberId)
        .eq('name', subject)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      return (data as GroupRow | null) ?? null;
    },

    async update(id, patch) {
      const { error } = await db
        .from('whatsapp_groups')
        .update(patch)
        .eq('id', id);
      if (error) console.error('[groups] update failed:', error.message);
      return !error;
    },

    async setInviteStatus(group, waIds, status) {
      if (waIds.length === 0) return 0;
      const { data: tenant } = await db
        .from('crm_tenants')
        .select('owner_user_id')
        .eq('id', group.tenant_id)
        .maybeSingle();
      const ownerId = (tenant as { owner_user_id: string | null } | null)
        ?.owner_user_id;
      if (!ownerId) return 0;

      const { data: contacts } = await db
        .from('contacts')
        .select('id')
        .eq('user_id', ownerId)
        .in('phone', waIds.flatMap(phoneVariants));
      const contactIds = ((contacts ?? []) as Array<{ id: string }>).map(
        (c) => c.id
      );
      if (contactIds.length === 0) return 0;

      const { data: changed } = await db
        .from('whatsapp_group_invites')
        .update({ status })
        .eq('group_id', group.id)
        .in('contact_id', contactIds)
        .select('id');
      return changed?.length ?? 0;
    },
  };
}
