import { describe, expect, it } from 'vitest';
import {
  buildLoginExtras,
  canManageTenant,
  isFacebookOrigin,
  parseEmbeddedSignupMessage,
  resolveSignupAssets,
} from './embedded-signup';

describe('isFacebookOrigin', () => {
  it('accepts facebook.com and its subdomains', () => {
    expect(isFacebookOrigin('https://www.facebook.com')).toBe(true);
    expect(isFacebookOrigin('https://web.facebook.com')).toBe(true);
    expect(isFacebookOrigin('https://facebook.com')).toBe(true);
  });

  it('rejects look-alike and non-https origins', () => {
    expect(isFacebookOrigin('https://facebook.com.evil.io')).toBe(false);
    expect(isFacebookOrigin('https://evilfacebook.com')).toBe(false);
    expect(isFacebookOrigin('http://www.facebook.com')).toBe(false);
    expect(isFacebookOrigin('not a url')).toBe(false);
  });
});

describe('parseEmbeddedSignupMessage', () => {
  const origin = 'https://www.facebook.com';

  it('returns the asset ids for a standard FINISH event', () => {
    const result = parseEmbeddedSignupMessage(
      origin,
      JSON.stringify({
        type: 'WA_EMBEDDED_SIGNUP',
        event: 'FINISH',
        data: { waba_id: 'w1', phone_number_id: 'p1', business_id: 'b1' },
      })
    );
    expect(result).toEqual({
      kind: 'finish',
      coexistence: false,
      wabaId: 'w1',
      phoneNumberId: 'p1',
      businessId: 'b1',
    });
  });

  it('flags the coexistence finish event', () => {
    const result = parseEmbeddedSignupMessage(origin, {
      type: 'WA_EMBEDDED_SIGNUP',
      event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
      data: { waba_id: 'w2', phone_number_id: 'p2' },
    });
    expect(result).toMatchObject({
      kind: 'finish',
      coexistence: true,
      wabaId: 'w2',
      phoneNumberId: 'p2',
    });
  });

  it('treats FINISH_ONLY_WABA as a finish with no phone number', () => {
    const result = parseEmbeddedSignupMessage(origin, {
      type: 'WA_EMBEDDED_SIGNUP',
      event: 'FINISH_ONLY_WABA',
      data: { waba_id: 'w3' },
    });
    expect(result).toMatchObject({ kind: 'finish', wabaId: 'w3' });
    expect(result && result.kind === 'finish' && result.phoneNumberId).toBe(
      undefined
    );
  });

  it('reports an abandoned flow with the step the user left on', () => {
    expect(
      parseEmbeddedSignupMessage(origin, {
        type: 'WA_EMBEDDED_SIGNUP',
        event: 'CANCEL',
        data: { current_step: 'PHONE_NUMBER_SETUP' },
      })
    ).toEqual({ kind: 'cancel', step: 'PHONE_NUMBER_SETUP' });
  });

  it('reports an error event with its message', () => {
    expect(
      parseEmbeddedSignupMessage(origin, {
        type: 'WA_EMBEDDED_SIGNUP',
        event: 'ERROR',
        data: { error_message: 'boom', error_code: '100' },
      })
    ).toEqual({ kind: 'error', message: 'boom', code: '100' });
  });

  it('ignores messages from other origins', () => {
    expect(
      parseEmbeddedSignupMessage('https://evil.example', {
        type: 'WA_EMBEDDED_SIGNUP',
        event: 'FINISH',
        data: { waba_id: 'w1', phone_number_id: 'p1' },
      })
    ).toBeNull();
  });

  it('ignores unrelated or malformed payloads', () => {
    expect(parseEmbeddedSignupMessage(origin, 'not json')).toBeNull();
    expect(parseEmbeddedSignupMessage(origin, { type: 'other' })).toBeNull();
    expect(
      parseEmbeddedSignupMessage(origin, {
        type: 'WA_EMBEDDED_SIGNUP',
        event: 'FINISH',
      })
    ).toBeNull();
  });
});

describe('buildLoginExtras', () => {
  it('adds the coexistence feature type when enabled', () => {
    expect(buildLoginExtras(true)).toEqual({
      setup: {},
      featureType: 'whatsapp_business_app_onboarding',
      sessionInfoVersion: '3',
    });
  });

  it('omits the feature type when coexistence is disabled', () => {
    const extras = buildLoginExtras(false);
    expect(extras).toEqual({ setup: {}, sessionInfoVersion: '3' });
    expect('featureType' in extras).toBe(false);
  });
});

describe('resolveSignupAssets', () => {
  const granted = ['w1', 'w2'];

  it('accepts a WABA the token was granted', () => {
    expect(
      resolveSignupAssets({ claimedWabaId: 'w2', grantedWabaIds: granted })
    ).toEqual({ ok: true, wabaId: 'w2' });
  });

  it('rejects a WABA the token was not granted (forged id)', () => {
    expect(
      resolveSignupAssets({ claimedWabaId: 'victim', grantedWabaIds: granted })
    ).toMatchObject({ ok: false });
  });

  it('discovers the WABA only when exactly one was granted', () => {
    expect(
      resolveSignupAssets({ claimedWabaId: '', grantedWabaIds: ['only'] })
    ).toEqual({ ok: true, wabaId: 'only' });
    expect(
      resolveSignupAssets({ claimedWabaId: '', grantedWabaIds: granted })
    ).toMatchObject({ ok: false });
    expect(
      resolveSignupAssets({ claimedWabaId: '', grantedWabaIds: [] })
    ).toMatchObject({ ok: false });
  });
});

describe('canManageTenant', () => {
  it('lets platform admins manage any tenant', () => {
    expect(
      canManageTenant({ isPlatformAdmin: true, ownerUserId: 'x', userId: 'u' })
    ).toBe(true);
  });

  it('lets the owner manage their own tenant', () => {
    expect(
      canManageTenant({ isPlatformAdmin: false, ownerUserId: 'u', userId: 'u' })
    ).toBe(true);
  });

  it('denies other users, including on tenants with no owner yet', () => {
    expect(
      canManageTenant({ isPlatformAdmin: false, ownerUserId: 'x', userId: 'u' })
    ).toBe(false);
    expect(
      canManageTenant({
        isPlatformAdmin: false,
        ownerUserId: null,
        userId: 'u',
      })
    ).toBe(false);
  });
});
