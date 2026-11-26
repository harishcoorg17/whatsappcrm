import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyGroupEvent,
  isGroupWebhookField,
  parseGroupEvents,
  type GroupEvent,
} from './group-events';
import type { GroupPatch, GroupRow, GroupStore } from './group-store';

function memoryStore(rows: GroupRow[]) {
  const invites: Array<{ group: string; waIds: string[]; status: string }> = [];
  const store: GroupStore = {
    async findByWa({ requestId, groupId, subject, phoneNumberId }) {
      return (
        rows.find((r) => requestId && r.wa_request_id === requestId) ??
        rows.find((r) => groupId && r.wa_group_id === groupId) ??
        rows.find(
          (r) =>
            subject &&
            phoneNumberId &&
            r.creation_status === 'creating' &&
            r.wa_phone_number_id === phoneNumberId &&
            r.name === subject
        ) ??
        null
      );
    },
    async update(id, patch: GroupPatch) {
      const row = rows.find((r) => r.id === id);
      if (!row) return false;
      Object.assign(row, patch);
      return true;
    },
    async setInviteStatus(group, waIds, status) {
      invites.push({ group: group.id, waIds, status });
      return waIds.length;
    },
  };
  return { store, invites };
}

const row = (over: Partial<GroupRow> = {}): GroupRow => ({
  id: 'g1',
  tenant_id: 't1',
  name: 'Kerala',
  description: null,
  invite_url: null,
  creation_status: 'creating',
  external_ref: 'tour-1',
  wa_request_id: 'req-1',
  wa_group_id: null,
  wa_phone_number_id: null,
  ...over,
});

const LINK = 'https://chat.whatsapp.com/AbC123xyz';

const created = (over: Partial<Extract<GroupEvent, { kind: 'created' }>> = {}): GroupEvent => ({
  kind: 'created',
  groupId: 'wa-1',
  requestId: 'req-1',
  inviteLink: LINK,
  subject: null,
  phoneNumberId: null,
  ...over,
});

describe('parseGroupEvents', () => {
  it('reads a successful group_create with its invite link, subject and number', () => {
    const events = parseGroupEvents('group_lifecycle_update', {
      metadata: { phone_number_id: 'pn-1' },
      groups: [
        { type: 'group_create', group_id: 'wa-1', request_id: 'req-1', subject: 'Kerala', invite_link: LINK },
      ],
    });
    expect(events).toEqual([
      created({ subject: 'Kerala', phoneNumberId: 'pn-1' }),
    ]);
  });

  it('reads a failed group_create with the error details', () => {
    const events = parseGroupEvents('group_lifecycle_update', {
      groups: [
        {
          type: 'group_create',
          request_id: 'req-1',
          errors: [{ code: 1, message: 'm', error_data: { details: 'Number not eligible' } }],
        },
      ],
    });
    expect(events).toEqual([
      { kind: 'create_failed', groupId: null, requestId: 'req-1', error: 'Number not eligible', subject: null, phoneNumberId: null },
    ]);
  });

  it('reads joins and leaves by wa_id', () => {
    expect(
      parseGroupEvents('group_participants_update', {
        groups: [
          {
            type: 'group_participants_add',
            group_id: 'wa-1',
            reason: 'invite_link',
            added_participants: [{ wa_id: '919886444711' }, { user_id: 'bsuid-only' }],
          },
        ],
      })
    ).toEqual([{ kind: 'joined', groupId: 'wa-1', waIds: ['919886444711'] }]);
    expect(
      parseGroupEvents('group_participants_update', {
        groups: [{ type: 'group_participants_remove', group_id: 'wa-1', removed_participants: [{ wa_id: '911' }] }],
      })
    ).toEqual([{ kind: 'left', groupId: 'wa-1', waIds: ['911'] }]);
  });

  it('ignores other group fields, unknown types and malformed values', () => {
    expect(parseGroupEvents('group_status_update', { groups: [{ type: 'group_suspend', group_id: 'x' }] })).toEqual([]);
    expect(parseGroupEvents('group_lifecycle_update', { groups: [{ type: 'group_delete' }] })).toEqual([]);
    expect(parseGroupEvents('group_lifecycle_update', null)).toEqual([]);
    expect(parseGroupEvents('group_lifecycle_update', { groups: 'nope' })).toEqual([]);
  });

  it('knows the four group webhook fields', () => {
    expect(isGroupWebhookField('group_lifecycle_update')).toBe(true);
    expect(isGroupWebhookField('messages')).toBe(false);
  });
});

describe('applyGroupEvent', () => {
  let rows: GroupRow[];
  beforeEach(() => {
    rows = [row()];
  });

  it('stores the invite link, activates the group and reports it to the hook', async () => {
    const { store } = memoryStore(rows);
    const onActive = vi.fn();
    const out = await applyGroupEvent(store, created(), { onActive });
    expect(out).toBe('active');
    expect(rows[0]).toMatchObject({ invite_url: LINK, creation_status: 'active', wa_group_id: 'wa-1', creation_error: null });
    expect(onActive).toHaveBeenCalledTimes(1);
    expect(onActive.mock.calls[0][0]).toMatchObject({ id: 'g1', external_ref: 'tour-1' });
    expect(onActive.mock.calls[0][1]).toBe(LINK);
  });

  it('fails the group when the link is missing or not a WhatsApp invite, without the hook', async () => {
    const { store } = memoryStore(rows);
    const onActive = vi.fn();
    expect(await applyGroupEvent(store, created({ inviteLink: 'https://evil.example/x' }), { onActive })).toBe('failed_no_link');
    expect(rows[0]).toMatchObject({ invite_url: null, creation_status: 'failed' });
    expect(onActive).not.toHaveBeenCalled();
  });

  it('records a failed creation with the reason', async () => {
    const { store } = memoryStore(rows);
    await applyGroupEvent(store, {
      kind: 'create_failed', groupId: null, requestId: 'req-1', error: 'Number not eligible', subject: null, phoneNumberId: null,
    });
    expect(rows[0]).toMatchObject({ creation_status: 'failed', creation_error: 'Number not eligible' });
  });

  it('ignores events for groups it does not know', async () => {
    const { store } = memoryStore(rows);
    expect(await applyGroupEvent(store, created({ groupId: 'zzz', requestId: 'nope' }))).toBe('unknown_group');
    expect(rows[0].invite_url).toBeNull();
  });

  it('finds the group by name and number when Meta’s create response carried no ids', async () => {
    rows = [row({ wa_request_id: null, wa_group_id: null, wa_phone_number_id: 'pn-1', name: 'Kerala' })];
    const { store } = memoryStore(rows);
    const out = await applyGroupEvent(store, created({ groupId: 'wa-9', requestId: 'req-x', subject: 'Kerala', phoneNumberId: 'pn-1' }));
    expect(out).toBe('active');
    expect(rows[0]).toMatchObject({ invite_url: LINK, wa_group_id: 'wa-9' });
  });

  it('does not match a same-named group on a different number', async () => {
    rows = [row({ wa_request_id: null, wa_phone_number_id: 'pn-1', name: 'Kerala' })];
    const { store } = memoryStore(rows);
    expect(await applyGroupEvent(store, created({ requestId: 'req-x', groupId: 'wa-9', subject: 'Kerala', phoneNumberId: 'pn-2' }))).toBe('unknown_group');
  });

  it('marks invited people joined once the group is known by its WhatsApp id', async () => {
    rows = [row({ wa_group_id: 'wa-1' })];
    const { store, invites } = memoryStore(rows);
    expect(await applyGroupEvent(store, { kind: 'joined', groupId: 'wa-1', waIds: ['911'] })).toBe('joined:1');
    expect(invites).toEqual([{ group: 'g1', waIds: ['911'], status: 'joined' }]);
  });
});
