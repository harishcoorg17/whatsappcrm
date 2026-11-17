import { normalizeStorePhone } from './phone';

/**
 * Pure mapping from a Shopify / WooCommerce webhook payload to a CRM event:
 * which automation trigger it fires, who the customer is, and the variables
 * (`{{vars.order_number}}` …) automation steps can use. No I/O in here.
 */

export type StorePlatform = 'shopify' | 'woocommerce';
export type StoreTrigger = 'order_placed' | 'order_fulfilled' | 'cart_abandoned';

export interface ParsedStoreEvent {
  /** Stable per business event, so provider retries are recognised. */
  dedupeKey: string;
  topic: string;
  trigger: StoreTrigger;
  /** Digits with country code, or null when the order carries no usable phone. */
  phone: string | null;
  name: string | null;
  vars: Record<string, string>;
  /** Shopify checkout token: links an abandoned cart to the order that completes it. */
  checkoutToken: string | null;
}

interface ParseInput {
  topic: string;
  payload: unknown;
  shopDomain: string;
  defaultCountryCode: string;
}

type Obj = Record<string, unknown>;

const MAX_ITEMS_SHOWN = 3;

function obj(v: unknown): Obj {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};
}

function str(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

function firstString(...values: unknown[]): string {
  for (const v of values) {
    const s = str(v);
    if (s) return s;
  }
  return '';
}

export function summariseItems(items: unknown): { text: string; count: number } {
  const list = Array.isArray(items) ? items : [];
  let count = 0;
  const parts: string[] = [];
  for (const raw of list) {
    const item = obj(raw);
    const qty = Number(item.quantity) > 0 ? Number(item.quantity) : 1;
    count += qty;
    const name = firstString(item.title, item.name);
    if (name && parts.length < MAX_ITEMS_SHOWN) {
      parts.push(qty > 1 ? `${qty} x ${name}` : name);
    }
  }
  const extra = list.length - parts.length;
  const text = parts.join(', ') + (extra > 0 && parts.length ? ` +${extra} more` : '');
  return { text, count };
}

function money(total: string, currency: string): string {
  return [currency, total].filter(Boolean).join(' ');
}

function fullName(first: string, last: string): string {
  return [first, last].filter(Boolean).join(' ');
}

export function parseShopifyEvent(input: ParseInput): ParsedStoreEvent | null {
  const trigger: StoreTrigger | null =
    input.topic === 'orders/create'
      ? 'order_placed'
      : input.topic === 'orders/fulfilled'
        ? 'order_fulfilled'
        : input.topic === 'checkouts/create'
          ? 'cart_abandoned'
          : null;
  if (!trigger) return null;

  const p = obj(input.payload);
  const id = firstString(p.id, p.token);
  if (!id) return null;

  const customer = obj(p.customer);
  const shipping = obj(p.shipping_address);
  const billing = obj(p.billing_address);
  const phone = normalizeStorePhone(
    firstString(p.phone, customer.phone, shipping.phone, billing.phone),
    input.defaultCountryCode
  );
  const first = firstString(customer.first_name, shipping.first_name, billing.first_name);
  const last = firstString(customer.last_name, shipping.last_name, billing.last_name);
  const items = summariseItems(p.line_items);
  const currency = firstString(p.currency, p.presentment_currency);
  const total = firstString(p.total_price);
  const fulfillment = obj(Array.isArray(p.fulfillments) ? p.fulfillments[0] : null);

  return {
    dedupeKey: `${input.topic}:${id}`,
    topic: input.topic,
    trigger,
    phone,
    name: fullName(first, last) || null,
    checkoutToken: firstString(p.checkout_token, p.token) || null,
    vars: {
      customer_name: first || 'there',
      customer_full_name: fullName(first, last),
      order_number: firstString(p.name, p.order_number, p.id),
      order_total: total,
      currency,
      order_total_formatted: money(total, currency),
      items: items.text,
      item_count: String(items.count),
      shop_name: input.shopDomain,
      order_status_url: str(p.order_status_url),
      checkout_url: str(p.abandoned_checkout_url),
      tracking_number: firstString(fulfillment.tracking_number),
      tracking_url: firstString(fulfillment.tracking_url),
    },
  };
}

export function parseWooEvent(input: ParseInput): ParsedStoreEvent | null {
  const p = obj(input.payload);
  const id = firstString(p.id);
  if (!id) return null;

  const status = str(p.status);
  let trigger: StoreTrigger | null = null;
  if (input.topic === 'order.created') trigger = 'order_placed';
  else if (input.topic === 'order.updated' && status === 'completed') {
    trigger = 'order_fulfilled';
  }
  if (!trigger) return null;

  const billing = obj(p.billing);
  const shipping = obj(p.shipping);
  const first = firstString(billing.first_name, shipping.first_name);
  const last = firstString(billing.last_name, shipping.last_name);
  const items = summariseItems(p.line_items);
  const currency = str(p.currency);
  const total = str(p.total);
  const orderKey = str(p.order_key);
  const base = input.shopDomain.startsWith('http')
    ? input.shopDomain
    : `https://${input.shopDomain}`;

  return {
    dedupeKey: `${trigger}:${id}`,
    topic: input.topic,
    trigger,
    phone: normalizeStorePhone(
      firstString(billing.phone, shipping.phone),
      input.defaultCountryCode
    ),
    name: fullName(first, last) || null,
    checkoutToken: null,
    vars: {
      customer_name: first || 'there',
      customer_full_name: fullName(first, last),
      order_number: firstString(p.number, p.id),
      order_total: total,
      currency,
      order_total_formatted: money(total, currency),
      items: items.text,
      item_count: String(items.count),
      shop_name: input.shopDomain,
      order_status_url: orderKey
        ? `${base.replace(/\/$/, '')}/checkout/order-received/${id}/?key=${orderKey}`
        : '',
      checkout_url: '',
      tracking_number: '',
      tracking_url: '',
    },
  };
}

export function parseStoreEvent(
  platform: StorePlatform,
  input: ParseInput
): ParsedStoreEvent | null {
  return platform === 'shopify' ? parseShopifyEvent(input) : parseWooEvent(input);
}

/** Variables an automation author can use, for the builder hint. */
export const STORE_VARIABLES = [
  'customer_name',
  'order_number',
  'order_total_formatted',
  'items',
  'order_status_url',
  'tracking_url',
  'checkout_url',
  'shop_name',
] as const;
