import { beforeEach, describe, expect, it } from 'vitest';
import { applyGroupEvent, isGroupWebhookField, parseGroupEvents } from './group-events';
import type { GroupPatch, GroupRow, GroupStore } from './group-store';

function memoryStore(rows: GroupRow[]) {
  const invites: Array<{ group: string; waIds: string[]; status: string }> = [];
  const store: GroupStore = {
    async findByWa({ requestId, groupId }) {
      return (
        rows.find((r) => requestId && r.wa_request_id === requestId) ??
        rows.find((r) => groupId && r.wa_group_id === groupId) ??
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
  id: 'g1', tenant_id: 't1', name: 'Kerala', description: null, invite_url: null,
  creation_status: 'creating', wa_request_id: 'req-1', wa_group_id: null, ...over,
});

const LINK = 'https://chat.whatsapp.com/AbC123xyz';

describe('parseGroupEvents', () => {
  it('reads a successful group_create with its invite link', () => {
    const events = parseGroupEvents('group_lifecycle_update', {
      groups: [{ type: 'group_create', group_id: 'wa-1', request_id: 'req-1', invite_link: LINK }],
    });
    expect(events).toEqual([{ kind: 'created', groupId: 'wa-1', requestId: 'req-1', inviteLink: LINK }]);
  });

  it('reads a failed group_create with the error details', () => {
    const events = parseGroupEvents('group_lifecycle_update', {
      groups: [{ type: 'group_create', request_id: 'req-1', errors: [{ code: 1, message: 'm', error_data: { details: 'Number not eligible' } }] }],
    });
    expect(events).toEqual([{ kind: 'create_failed', groupId: null, requestId: 'req-1', error: 'Number not eligible' }]);
  });

  it('reads joins and leaves by wa_id', () => {
    expect(parseGroupEvents('group_participants_update', {
      groups: [{ type: 'group_participants_add', group_id: 'wa-1', reason: 'invite_link', added_participants: [{ wa_id: '919886444711' }, { user_id: 'bsuid-only' }] }],
    })).toEqual([{ kind: 'joined', groupId: 'wa-1', waIds: ['919886444711'] }]);
    expect(parseGroupEvents('group_participants_update', {
      groups: [{ type: 'group_participants_remove', group_id: 'wa-1', removed_participants: [{ wa_id: '911' }] }],
    })).toEqual([{ kind: 'left', groupId: 'wa-1', waIds: ['911'] }]);
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
  beforeEach(() => { rows = [row()]; });

  it('stores the invite link and activates the group', async () => {
    const { store } = memoryStore(rows);
    const out = await applyGroupEvent(store, { kind: 'created', groupId: 'wa-1', requestId: 'req-1', inviteLink: LINK });
    expect(out).toBe('active');
    expect(rows[0]).toMatchObject({ invite_url: LINK, creation_status: 'active', wa_group_id: 'wa-1', creation_error: null });
  });

  it('fails the group when the link is missing or not a WhatsApp invite', async () => {
    const { store } = memoryStore(rows);
    expect(await applyGroupEvent(store, { kind: 'created', groupId: 'wa-1', requestId: 'req-1', inviteLink: 'https://evil.example/x' })).toBe('failed_no_link');
    expect(rows[0]).toMatchObject({ invite_url: null, creation_status: 'failed' });
  });

  it('records a failed creation with the reason', async () => {
    const { store } = memoryStore(rows);
    await applyGroupEvent(store, { kind: 'create_failed', groupId: null, requestId: 'req-1', error: 'Number not eligible' });
    expect(rows[0]).toMatchObject({ creation_status: 'failed', creation_error: 'Number not eligible' });
  });

  it('ignores events for groups it does not know', async () => {
    const { store } = memoryStore(rows);
    expect(await applyGroupEvent(store, { kind: 'created', groupId: 'zzz', requestId: 'nope', inviteLink: LINK })).toBe('unknown_group');
    expect(rows[0].invite_url).toBeNull();
  });

  it('marks invited people joined once the group is known by its WhatsApp id', async () => {
    rows = [row({ wa_group_id: 'wa-1' })];
    const { store, invites } = memoryStore(rows);
    expect(await applyGroupEvent(store, { kind: 'joined', groupId: 'wa-1', waIds: ['911'] })).toBe('joined:1');
    expect(invites).toEqual([{ group: 'g1', waIds: ['911'], status: 'joined' }]);
  });
});
