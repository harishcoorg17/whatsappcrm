/**
 * Pure helpers for WhatsApp Embedded Signup (v4) and tenant authorization.
 *
 * Kept free of I/O so every rule is unit-testable. The signup route and the
 * onboarding page compose these with the network and database calls.
 */

export const COEXISTENCE_FEATURE_TYPE = 'whatsapp_business_app_onboarding';

const SIGNUP_MESSAGE_TYPE = 'WA_EMBEDDED_SIGNUP';

const FINISH_EVENTS = new Set([
  'FINISH',
  'FINISH_ONLY_WABA',
  'FINISH_GRANT_ONLY_API_ACCESS',
  'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
]);

export type SignupMessage =
  | {
      kind: 'finish';
      coexistence: boolean;
      wabaId: string;
      phoneNumberId?: string;
      businessId?: string;
    }
  | { kind: 'cancel'; step?: string }
  | { kind: 'error'; message?: string; code?: string };

/** Meta says to accept the message only when the origin ends with facebook.com. */
export function isFacebookOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return (
    url.hostname === 'facebook.com' || url.hostname.endsWith('.facebook.com')
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function parseEmbeddedSignupMessage(
  origin: string,
  rawData: unknown
): SignupMessage | null {
  if (!isFacebookOrigin(origin)) return null;

  let parsed: unknown = rawData;
  if (typeof rawData === 'string') {
    try {
      parsed = JSON.parse(rawData);
    } catch {
      return null;
    }
  }

  const message = asRecord(parsed);
  if (!message || message.type !== SIGNUP_MESSAGE_TYPE) return null;

  const event = asString(message.event);
  const data = asRecord(message.data);
  if (!event) return null;

  if (event === 'CANCEL') {
    return { kind: 'cancel', step: asString(data?.current_step) };
  }

  if (event === 'ERROR') {
    return {
      kind: 'error',
      message: asString(data?.error_message),
      code: asString(data?.error_code),
    };
  }

  if (!FINISH_EVENTS.has(event) || !data) return null;

  const wabaId = asString(data.waba_id);
  if (!wabaId) return null;

  return {
    kind: 'finish',
    coexistence: event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
    wabaId,
    phoneNumberId: asString(data.phone_number_id),
    businessId: asString(data.business_id),
  };
}

/** The `extras` object passed to `FB.login` for Embedded Signup. */
export function buildLoginExtras(
  coexistence: boolean
): Record<string, unknown> {
  return {
    setup: {},
    ...(coexistence ? { featureType: COEXISTENCE_FEATURE_TYPE } : {}),
    sessionInfoVersion: '3',
  };
}

export type AssetResolution =
  | { ok: true; wabaId: string }
  | { ok: false; error: string };

/**
 * Decides which WABA to store, trusting only what Meta granted to the token.
 *
 * The browser supplies a claimed WABA id, but a claim is never enough on its
 * own: without this check a tenant could submit another business's id.
 */
export function resolveSignupAssets(params: {
  claimedWabaId: string;
  grantedWabaIds: readonly string[];
}): AssetResolution {
  const { claimedWabaId, grantedWabaIds } = params;

  if (claimedWabaId) {
    return grantedWabaIds.includes(claimedWabaId)
      ? { ok: true, wabaId: claimedWabaId }
      : {
          ok: false,
          error: 'The WhatsApp Business Account does not belong to this signup',
        };
  }

  if (grantedWabaIds.length === 1) {
    return { ok: true, wabaId: grantedWabaIds[0] };
  }

  return {
    ok: false,
    error:
      grantedWabaIds.length === 0
        ? 'Meta did not grant access to a WhatsApp Business Account'
        : 'Several WhatsApp Business Accounts were granted; finish the signup again and select one',
  };
}

/** A tenant may be changed by a platform admin or by its own owner. */
export function canManageTenant(params: {
  isPlatformAdmin: boolean;
  ownerUserId: string | null;
  userId: string;
}): boolean {
  if (params.isPlatformAdmin) return true;
  return params.ownerUserId !== null && params.ownerUserId === params.userId;
}
