/**
 * Asks WhatsApp to create the group behind a `whatsapp_groups` row. Meta answers asynchronously:
 * the row becomes `creating` here and `active` (with its invite link) when the webhook arrives.
 */

import {
  MetaGroupsError,
  createWhatsAppGroup,
  type CreateGroupArgs,
} from '@/lib/whatsapp/groups-api';
import type { GroupRow, GroupStore } from './group-store';

export interface GroupNumber {
  phoneNumberId: string;
  accessToken: string;
}

export interface AutoCreateDeps {
  store: GroupStore;
  /** The tenant's numbers in the order to try them. Empty when WhatsApp is not connected. */
  numbers: GroupNumber[];
  createGroup?: (
    args: CreateGroupArgs
  ) => Promise<{ requestId: string | null; groupId: string | null }>;
}

export type AutoCreateResult =
  | { ok: true; status: 'creating' | 'already_active' | 'already_creating' }
  | { ok: false; message: string };

const NOT_CONNECTED = 'WhatsApp is not connected for this account.';

/** A group that has a link, or a request in flight, is left alone, so retries are safe. */
export function needsCreation(
  group: Pick<GroupRow, 'invite_url' | 'creation_status'>
): boolean {
  return (
    !group.invite_url &&
    group.creation_status !== 'creating' &&
    group.creation_status !== 'active'
  );
}

/** Tries each number until WhatsApp accepts the request; a number that is not eligible is skipped. */
export async function startGroupCreation(
  group: GroupRow,
  deps: AutoCreateDeps
): Promise<AutoCreateResult> {
  if (group.creation_status === 'creating')
    return { ok: true, status: 'already_creating' };
  if (!needsCreation(group)) return { ok: true, status: 'already_active' };

  const fail = async (message: string): Promise<AutoCreateResult> => {
    await deps.store.update(group.id, {
      creation_status: 'failed',
      creation_error: message.slice(0, 500),
    });
    return { ok: false, message };
  };

  if (deps.numbers.length === 0) return fail(NOT_CONNECTED);

  const create = deps.createGroup ?? createWhatsAppGroup;
  let lastError = 'WhatsApp could not create the group.';
  for (const number of deps.numbers) {
    try {
      const created = await create({
        phoneNumberId: number.phoneNumberId,
        accessToken: number.accessToken,
        subject: group.name,
        description: group.description,
      });
      await deps.store.update(group.id, {
        creation_status: 'creating',
        creation_error: null,
        wa_request_id: created.requestId,
        wa_group_id: created.groupId,
        wa_phone_number_id: number.phoneNumberId,
      });
      return { ok: true, status: 'creating' };
    } catch (err) {
      lastError = err instanceof MetaGroupsError ? err.message : lastError;
      console.error('[groups] create failed on a number:', lastError);
    }
  }
  return fail(lastError);
}
