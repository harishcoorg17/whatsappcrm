import { describe, expect, it, vi } from 'vitest';
import { MetaGroupsError } from '@/lib/whatsapp/groups-api';
import { needsCreation, startGroupCreation } from './auto-create';
import type { GroupPatch, GroupRow, GroupStore } from './group-store';

const row = (over: Partial<GroupRow> = {}): GroupRow => ({
  id: 'g1',
  tenant_id: 't1',
  name: 'Kerala (2026-12-05)',
  description: 'Led by Ravi',
  invite_url: null,
  creation_status: 'manual',
  wa_request_id: null,
  wa_group_id: null,
  wa_phone_number_id: null,
  ...over,
});

function store() {
  const patches: GroupPatch[] = [];
  const s: GroupStore = {
    findByWa: async () => null,
    update: async (_id, patch) => {
      patches.push(patch);
      return true;
    },
    setInviteStatus: async () => 0,
  };
  return { s, patches };
}

const creds = [{ phoneNumberId: 'pn-1', accessToken: 'tok' }];

describe('needsCreation', () => {
  it('is true only for a group with no link and no request in flight', () => {
    expect(needsCreation({ invite_url: null, creation_status: 'manual' })).toBe(
      true
    );
    expect(needsCreation({ invite_url: null, creation_status: 'failed' })).toBe(
      true
    );
    expect(
      needsCreation({ invite_url: null, creation_status: 'creating' })
    ).toBe(false);
    expect(needsCreation({ invite_url: null, creation_status: 'active' })).toBe(
      false
    );
    expect(
      needsCreation({
        invite_url: 'https://chat.whatsapp.com/x',
        creation_status: 'manual',
      })
    ).toBe(false);
  });
});

describe('startGroupCreation', () => {
  it('sends the group name and description to WhatsApp and marks the row creating', async () => {
    const { s, patches } = store();
    const createGroup = vi
      .fn()
      .mockResolvedValue({ requestId: 'req-9', groupId: null });
    const res = await startGroupCreation(row(), {
      store: s,
      numbers: creds,
      createGroup,
    });
    expect(res).toEqual({ ok: true, status: 'creating' });
    expect(createGroup).toHaveBeenCalledWith({
      phoneNumberId: 'pn-1',
      accessToken: 'tok',
      subject: 'Kerala (2026-12-05)',
      description: 'Led by Ravi',
    });
    expect(patches).toEqual([
      {
        creation_status: 'creating',
        creation_error: null,
        wa_request_id: 'req-9',
        wa_group_id: null,
        wa_phone_number_id: 'pn-1',
      },
    ]);
  });

  it('does nothing for a group that already has a link or a request in flight', async () => {
    const { s, patches } = store();
    const createGroup = vi.fn();
    expect(
      await startGroupCreation(row({ creation_status: 'creating' }), {
        store: s,
        numbers: creds,
        createGroup,
      })
    ).toEqual({ ok: true, status: 'already_creating' });
    expect(
      await startGroupCreation(
        row({ invite_url: 'https://chat.whatsapp.com/x' }),
        { store: s, numbers: creds, createGroup }
      )
    ).toEqual({ ok: true, status: 'already_active' });
    expect(createGroup).not.toHaveBeenCalled();
    expect(patches).toEqual([]);
  });

  it('marks the row failed when WhatsApp is not connected', async () => {
    const { s, patches } = store();
    const res = await startGroupCreation(row(), {
      store: s,
      numbers: [],
      createGroup: vi.fn(),
    });
    expect(res).toEqual({
      ok: false,
      message: 'WhatsApp is not connected for this account.',
    });
    expect(patches[0]).toMatchObject({ creation_status: 'failed' });
  });

  it('marks the row failed with Meta’s reason, and hides unexpected errors', async () => {
    const a = store();
    const meta = vi
      .fn()
      .mockRejectedValue(
        new MetaGroupsError('Number is not an Official Business Account', 400)
      );
    expect(
      await startGroupCreation(row(), {
        store: a.s,
        numbers: creds,
        createGroup: meta,
      })
    ).toEqual({
      ok: false,
      message: 'Number is not an Official Business Account',
    });
    expect(a.patches[0]).toMatchObject({
      creation_status: 'failed',
      creation_error: 'Number is not an Official Business Account',
    });

    const b = store();
    const boom = vi
      .fn()
      .mockRejectedValue(new Error('socket hang up at 10.0.0.4'));
    const res = await startGroupCreation(row(), {
      store: b.s,
      numbers: creds,
      createGroup: boom,
    });
    expect(res).toEqual({
      ok: false,
      message: 'WhatsApp could not create the group.',
    });
  });

  it('falls back to the next number when the first is not eligible, and remembers which one worked', async () => {
    const { s, patches } = store();
    const createGroup = vi
      .fn()
      .mockRejectedValueOnce(
        new MetaGroupsError(
          'Groups APIs are only available for eligible phone numbers.',
          400
        )
      )
      .mockResolvedValueOnce({ requestId: 'req-2', groupId: null });
    const numbers = [
      { phoneNumberId: 'main', accessToken: 'a' },
      { phoneNumberId: 'amstago', accessToken: 'b' },
    ];
    expect(
      await startGroupCreation(row(), { store: s, numbers, createGroup })
    ).toEqual({ ok: true, status: 'creating' });
    expect(createGroup.mock.calls.map((c) => c[0].phoneNumberId)).toEqual([
      'main',
      'amstago',
    ]);
    expect(patches).toEqual([
      expect.objectContaining({
        creation_status: 'creating',
        wa_phone_number_id: 'amstago',
      }),
    ]);
  });

  it('fails with the last reason when no number is eligible', async () => {
    const { s, patches } = store();
    const createGroup = vi
      .fn()
      .mockRejectedValue(new MetaGroupsError('Not eligible', 400));
    const numbers = [
      { phoneNumberId: 'main', accessToken: 'a' },
      { phoneNumberId: 'amstago', accessToken: 'b' },
    ];
    expect(
      await startGroupCreation(row(), { store: s, numbers, createGroup })
    ).toEqual({ ok: false, message: 'Not eligible' });
    expect(createGroup).toHaveBeenCalledTimes(2);
    expect(patches).toEqual([
      { creation_status: 'failed', creation_error: 'Not eligible' },
    ]);
  });
});
