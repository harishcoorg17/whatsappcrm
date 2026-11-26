/**
 * Meta's group webhooks, turned into plain events and applied to our group rows.
 *
 *  - group_lifecycle_update: a create request finished (with the invite link) or failed;
 *  - group_participants_update: someone joined through the invite link or left.
 * group_settings_update and group_status_update are acknowledged and ignored.
 */

import { INVITE_LINK_PATTERN } from '@/lib/whatsapp/groups-api';
import type { GroupStore } from './group-store';

export const GROUP_WEBHOOK_FIELDS = [
  'group_lifecycle_update',
  'group_participants_update',
  'group_settings_update',
  'group_status_update',
] as const;

export function isGroupWebhookField(field: string): boolean {
  return (GROUP_WEBHOOK_FIELDS as readonly string[]).includes(field);
}

export type GroupEvent =
  | {
      kind: 'created';
      groupId: string | null;
      requestId: string | null;
      inviteLink: string | null;
    }
  | {
      kind: 'create_failed';
      groupId: string | null;
      requestId: string | null;
      error: string;
    }
  | { kind: 'joined'; groupId: string; waIds: string[] }
  | { kind: 'left'; groupId: string; waIds: string[] };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null =>
  typeof v === 'string' && v ? v : null;

const MAX_ERROR_LENGTH = 500;

function errorText(errors: unknown): string {
  const first = Array.isArray(errors) ? errors[0] : null;
  if (!isObj(first)) return 'WhatsApp could not create the group.';
  const details = isObj(first.error_data)
    ? str(first.error_data.details)
    : null;
  const text = details ?? str(first.message) ?? str(first.title);
  return (text ?? 'WhatsApp could not create the group.').slice(
    0,
    MAX_ERROR_LENGTH
  );
}

function waIdsOf(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((p) => (isObj(p) ? str(p.wa_id) : null))
    .filter((id): id is string => !!id);
}

function parseLifecycle(item: Obj): GroupEvent | null {
  if (item.type !== 'group_create') return null;
  const groupId = str(item.group_id);
  const requestId = str(item.request_id);
  if (Array.isArray(item.errors) && item.errors.length > 0) {
    return {
      kind: 'create_failed',
      groupId,
      requestId,
      error: errorText(item.errors),
    };
  }
  return {
    kind: 'created',
    groupId,
    requestId,
    inviteLink: str(item.invite_link),
  };
}

function parseParticipants(item: Obj): GroupEvent | null {
  const groupId = str(item.group_id);
  if (!groupId) return null;
  if (item.type === 'group_participants_add') {
    return { kind: 'joined', groupId, waIds: waIdsOf(item.added_participants) };
  }
  if (item.type === 'group_participants_remove') {
    return { kind: 'left', groupId, waIds: waIdsOf(item.removed_participants) };
  }
  return null;
}

/** Events carried by one webhook `change` (its `field` and `value`). */
export function parseGroupEvents(field: string, value: unknown): GroupEvent[] {
  if (!isObj(value) || !Array.isArray(value.groups)) return [];
  const parse =
    field === 'group_lifecycle_update'
      ? parseLifecycle
      : field === 'group_participants_update'
        ? parseParticipants
        : null;
  if (!parse) return [];
  return value.groups
    .filter(isObj)
    .map(parse)
    .filter((e): e is GroupEvent => e !== null);
}

/** Applies one event. Returns a short outcome for the log; never throws on an unknown group. */
export async function applyGroupEvent(
  store: GroupStore,
  event: GroupEvent
): Promise<string> {
  if (event.kind === 'joined' || event.kind === 'left') {
    const group = await store.findByWa({ groupId: event.groupId });
    if (!group) return 'unknown_group';
    const changed = await store.setInviteStatus(group, event.waIds, event.kind);
    return `${event.kind}:${changed}`;
  }

  const group = await store.findByWa({
    requestId: event.requestId,
    groupId: event.groupId,
  });
  if (!group) return 'unknown_group';

  if (event.kind === 'create_failed') {
    await store.update(group.id, {
      creation_status: 'failed',
      creation_error: event.error,
    });
    return 'failed';
  }

  if (!event.inviteLink || !INVITE_LINK_PATTERN.test(event.inviteLink)) {
    await store.update(group.id, {
      creation_status: 'failed',
      creation_error:
        'WhatsApp created the group but sent no valid invite link.',
    });
    return 'failed_no_link';
  }
  await store.update(group.id, {
    invite_url: event.inviteLink,
    creation_status: 'active',
    creation_error: null,
    wa_group_id: event.groupId ?? group.wa_group_id,
  });
  return 'active';
}
