import { describe, expect, it } from 'vitest';
import {
  validateGroupDraft,
  validateGroupInput,
  validateInviteUrl,
} from './invite-url';

describe('validateInviteUrl', () => {
  it('accepts a group invite link and trims it', () => {
    const r = validateInviteUrl(
      'group',
      '  https://chat.whatsapp.com/AbC123_-xyz '
    );
    expect(r).toEqual({
      ok: true,
      url: 'https://chat.whatsapp.com/AbC123_-xyz',
    });
  });

  it('drops the tracking WhatsApp adds when a link is copied, keeping only the link', () => {
    for (const raw of [
      'https://chat.whatsapp.com/AbC123xyz?mode=gi_t',
      'https://chat.whatsapp.com/AbC123xyz?mode=ems_copy_t#frag',
      'https://chat.whatsapp.com/AbC123xyz/',
    ]) {
      expect(validateInviteUrl('group', raw)).toEqual({
        ok: true,
        url: 'https://chat.whatsapp.com/AbC123xyz',
      });
    }
  });

  it('still rejects a query on a link that is not a WhatsApp invite', () => {
    expect(
      validateInviteUrl(
        'group',
        'https://evil.com/AbC?u=https://chat.whatsapp.com/x'
      ).ok
    ).toBe(false);
    expect(
      validateInviteUrl('group', 'https://chat.whatsapp.com/?mode=gi_t').ok
    ).toBe(false);
  });

  it('accepts a channel link', () => {
    expect(
      validateInviteUrl('channel', 'https://whatsapp.com/channel/0029VaABC123')
        .ok
    ).toBe(true);
  });

  it.each([
    'http://chat.whatsapp.com/abc',
    'https://evil.com/chat.whatsapp.com/abc',
    'https://chat.whatsapp.com.evil.com/abc',
    'https://chat.whatsapp.com@evil.com/abc',
    'https://chat.whatsapp.com:8080/abc',
    'https://chat.whatsapp.com/abc/def',
    'https://chat.whatsapp.com/',
    'javascript:alert(1)',
    'https://wa.me/123',
    'https://chat.whatsapp.com/abc def',
  ])('rejects %s for a group', (url) => {
    expect(validateInviteUrl('group', url).ok).toBe(false);
  });

  it('does not accept a channel link as a group link or vice versa', () => {
    expect(
      validateInviteUrl('group', 'https://whatsapp.com/channel/abc').ok
    ).toBe(false);
    expect(
      validateInviteUrl('channel', 'https://chat.whatsapp.com/abc').ok
    ).toBe(false);
  });

  it('rejects non-strings, empty and over-long values', () => {
    expect(validateInviteUrl('group', undefined).ok).toBe(false);
    expect(validateInviteUrl('group', '  ').ok).toBe(false);
    expect(
      validateInviteUrl('group', `https://chat.whatsapp.com/${'a'.repeat(300)}`)
        .ok
    ).toBe(false);
  });
});

describe('validateGroupInput', () => {
  const base = {
    kind: 'group',
    name: ' Goa Dec 12 ',
    invite_url: 'https://chat.whatsapp.com/abc',
    capacity: '30',
    departure_date: '2026-12-12',
  };

  it('normalises a valid group', () => {
    const r = validateGroupInput(base);
    expect(r.ok && r.value).toMatchObject({
      name: 'Goa Dec 12',
      capacity: 30,
      departure_date: '2026-12-12',
      is_active: true,
      description: null,
    });
  });

  it('rejects a bad kind, empty name, bad capacity and bad date', () => {
    expect(validateGroupInput({ ...base, kind: 'dm' }).ok).toBe(false);
    expect(validateGroupInput({ ...base, name: ' ' }).ok).toBe(false);
    expect(validateGroupInput({ ...base, capacity: 0 }).ok).toBe(false);
    expect(validateGroupInput({ ...base, capacity: 2.5 }).ok).toBe(false);
    expect(
      validateGroupInput({ ...base, departure_date: '2026-02-31' }).ok
    ).toBe(false);
    expect(validateGroupInput({ ...base, name: 'x'.repeat(121) }).ok).toBe(
      false
    );
  });

  it('drops capacity and date for channels', () => {
    const r = validateGroupInput({
      ...base,
      kind: 'channel',
      invite_url: 'https://whatsapp.com/channel/abc',
    });
    expect(r.ok && r.value).toMatchObject({
      capacity: null,
      departure_date: null,
    });
  });

  it('rejects a mismatched link for the kind', () => {
    expect(
      validateGroupInput({
        ...base,
        invite_url: 'https://whatsapp.com/channel/abc',
      }).ok
    ).toBe(false);
  });
});

describe('validateGroupDraft', () => {
  it('accepts a group with no invite link, returning no link', () => {
    const r = validateGroupDraft({
      kind: 'group',
      name: ' Kerala · 5 Dec ',
      description: 'Led by Ravi',
      capacity: '8',
      departure_date: '2026-12-05',
    });
    expect(r).toEqual({
      ok: true,
      value: {
        kind: 'group',
        name: 'Kerala · 5 Dec',
        invite_url: null,
        description: 'Led by Ravi',
        capacity: 8,
        departure_date: '2026-12-05',
        is_active: true,
      },
    });
  });

  it('always makes a group, even if a channel was asked for', () => {
    const r = validateGroupDraft({ kind: 'channel', name: 'Updates' });
    expect(r.ok && r.value.kind).toBe('group');
  });

  it('rejects an empty name, a bad capacity and a bad date', () => {
    expect(validateGroupDraft({ name: '  ' }).ok).toBe(false);
    expect(validateGroupDraft({ name: 'x', capacity: 0 }).ok).toBe(false);
    expect(
      validateGroupDraft({ name: 'x', departure_date: '2026-02-31' }).ok
    ).toBe(false);
  });
});
