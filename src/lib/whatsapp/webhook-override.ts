/**
 * Pure helpers for finding and replacing Meta webhook overrides.
 *
 * Meta sends a webhook to the first callback that applies, in this order:
 * the phone number's own, then the WhatsApp account's, then the app's.
 * Account-level events (account_update, templates) are never overridden, but
 * `messages` is, so a leftover override can swallow inbound messages while the
 * app-level callback still looks healthy.
 */

export interface OverrideState {
  /** Callback set on the phone number itself, if any. */
  phone: string | null;
  /** Callback set on the WhatsApp account for our app, if any. */
  waba: string | null;
  /** The app-level callback, when Meta reports it. */
  app: string | null;
}

export interface SubscribedAppsResponse {
  data?: Array<{
    override_callback_uri?: string | null;
    whatsapp_business_api_data?: { id?: string };
  }>;
}

export interface PhoneConfigResponse {
  webhook_configuration?: {
    application?: string;
    phone_number?: string;
    whatsapp_business_account?: string;
  };
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function readOverrides(
  subscribed: SubscribedAppsResponse | null,
  phone: PhoneConfigResponse | null,
  appId: string
): OverrideState {
  const apps = subscribed?.data ?? [];
  const ours =
    apps.find((entry) => entry.whatsapp_business_api_data?.id === appId) ??
    apps[0];
  const config = phone?.webhook_configuration;

  return {
    phone: clean(config?.phone_number),
    waba:
      clean(ours?.override_callback_uri) ??
      clean(config?.whatsapp_business_account),
    app: clean(config?.application),
  };
}

export interface FixPlan {
  fixPhone: boolean;
  fixWaba: boolean;
}

/** Only touch an override that sends messages somewhere other than `desired`. */
export function planOverrideFix(
  state: OverrideState,
  desired: string
): FixPlan {
  const elsewhere = (url: string | null) => url !== null && url !== desired;
  return {
    fixPhone: elsewhere(state.phone),
    fixWaba: elsewhere(state.waba),
  };
}

interface HeaderReader {
  get(name: string): string | null;
}

function firstValue(value: string): string {
  return value.split(',')[0].trim();
}

/**
 * The public webhook URL for this deployment, taken from the request that an
 * admin made on the live site. Meta only accepts https, so anything else
 * (for example a local http request) yields null instead of a bad URL.
 */
export function webhookUrlFromHeaders(
  headers: HeaderReader,
  siteUrl: string | undefined
): string | null {
  const host = headers.get('x-forwarded-host') ?? headers.get('host');
  const proto = firstValue(headers.get('x-forwarded-proto') ?? 'https');

  const origin = host
    ? `${proto}://${firstValue(host)}`
    : (siteUrl?.trim().replace(/\/+$/, '') ?? null);

  if (!origin || !origin.startsWith('https://')) return null;
  return `${origin}/api/whatsapp/webhook`;
}
