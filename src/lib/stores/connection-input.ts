import type { StorePlatform } from './events';

export const MAX_STORES_PER_TENANT = 5;
const DEFAULT_ABANDONED_MINUTES = 60;
const MIN_ABANDONED_MINUTES = 5;
const MAX_ABANDONED_MINUTES = 10_080;

export interface ConnectionInput {
  platform: StorePlatform;
  shopDomain: string;
  /** Shopify: the signing key from the store. WooCommerce: generated for the merchant. */
  secret: string | null;
  defaultCountryCode: string;
  abandonedAfterMinutes: number;
}

/** Bare host for display and URLs: strips scheme, path and trailing slash. */
export function cleanShopDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
}

const HOST_PATTERN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/;

export function parseConnectionInput(
  raw: unknown
): { ok: true; value: ConnectionInput } | { ok: false; error: string } {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const platform = body.platform;
  if (platform !== 'shopify' && platform !== 'woocommerce') {
    return { ok: false, error: 'Choose Shopify or WooCommerce' };
  }
  const shopDomain = cleanShopDomain(typeof body.shopDomain === 'string' ? body.shopDomain : '');
  if (!shopDomain || !shopDomain.includes('.') || !HOST_PATTERN.test(shopDomain)) {
    return { ok: false, error: 'Enter your store domain, e.g. mystore.myshopify.com' };
  }

  let secret: string | null = null;
  if (platform === 'shopify') {
    secret = typeof body.secret === 'string' ? body.secret.trim() : '';
    if (secret.length < 8) {
      return { ok: false, error: "Paste the webhook signing key from your Shopify store" };
    }
  }

  const cc = typeof body.defaultCountryCode === 'string' ? body.defaultCountryCode.replace(/\D/g, '') : '91';
  if (!/^\d{1,4}$/.test(cc)) return { ok: false, error: 'Country code must be 1-4 digits' };

  const minutes =
    body.abandonedAfterMinutes === undefined
      ? DEFAULT_ABANDONED_MINUTES
      : Number(body.abandonedAfterMinutes);
  if (
    !Number.isInteger(minutes) ||
    minutes < MIN_ABANDONED_MINUTES ||
    minutes > MAX_ABANDONED_MINUTES
  ) {
    return {
      ok: false,
      error: `Abandoned-cart wait must be ${MIN_ABANDONED_MINUTES}-${MAX_ABANDONED_MINUTES} minutes`,
    };
  }

  return {
    ok: true,
    value: { platform, shopDomain, secret, defaultCountryCode: cc, abandonedAfterMinutes: minutes },
  };
}
