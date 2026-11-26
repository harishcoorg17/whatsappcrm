/**
 * Asks WhatsApp to create the group behind a `whatsapp_groups` row. Meta answers asynchronously:
 * the row becomes `creating` here and `active` (with its invite link) when the webhook arrives.
 */

import { MetaGroupsError, createWhatsAppGroup, type CreateGroupArgs } from '@/lib/whatsapp/groups-api';
import type { GroupRow, GroupStore } from './group-store';

export interface AutoCreateDeps {
  store: GroupStore;
  /** The tenant's number and token, or null when WhatsApp is not connected. */
  credentials: { phoneNumberId: string; accessToken: string } | null;
  createGroup?: (args: CreateGroupArgs) => Promise<{ requestId: string | null; groupId: string | null }>;
}

export type AutoCreateResult =
  | { ok: true; status: 'creating' | 'already_active' | 'already_creating' }
  | { ok: false; message: string };

const NOT_CONNECTED = 'WhatsApp is not connected for this account.';

/** A group that has a link, or a request in flight, is left alone, so retries are safe. */
export function needsCreation(group: Pick<GroupRow, 'invite_url' | 'creation_status'>): boolean {
  return !group.invite_url && group.creation_status !== 'creating' && group.creation_status !== 'active';
}

export async function startGroupCreation(
  group: GroupRow,
  deps: AutoCreateDeps
): Promise<AutoCreateResult> {
  if (group.creation_status === 'creating') return { ok: true, status: 'already_creating' };
  if (!needsCreation(group)) return { ok: true, status: 'already_active' };

  const fail = async (message: string): Promise<AutoCreateResult> => {
    await deps.store.update(group.id, { creation_status: 'failed', creation_error: message.slice(0, 500) });
    return { ok: false, message };
  };

  if (!deps.credentials) return fail(NOT_CONNECTED);

  try {
    const create = deps.createGroup ?? createWhatsAppGroup;
    const created = await create({
      phoneNumberId: deps.credentials.phoneNumberId,
      accessToken: deps.credentials.accessToken,
      subject: group.name,
      description: group.description,
    });
    await deps.store.update(group.id, {
      creation_status: 'creating',
      creation_error: null,
      wa_request_id: created.requestId,
      wa_group_id: created.groupId,
    });
    return { ok: true, status: 'creating' };
  } catch (err) {
    const message = err instanceof MetaGroupsError ? err.message : 'WhatsApp could not create the group.';
    console.error('[groups] create failed:', message);
    return fail(message);
  }
}
