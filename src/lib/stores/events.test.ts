import { describe, expect, test } from 'vitest';
import { parseShopifyEvent, parseWooEvent, summariseItems } from './events';
import { normalizeStorePhone } from './phone';
import {
  computeStoreSignature,
  verifyStoreSignature,
  generatePublicId,
} from './signature';

const base = { shopDomain: 'demo.myshopify.com', defaultCountryCode: '91' };

describe('normalizeStorePhone', () => {
  test('adds the default country code to a bare 10-digit number', () => {
    expect(normalizeStorePhone('98765 43210')).toBe('919876543210');
  });
  test('keeps an explicit + number as-is', () => {
    expect(normalizeStorePhone('+1 (415) 555-0100')).toBe('14155550100');
  });
  test('strips a leading 00 international prefix', () => {
    expect(normalizeStorePhone('0044 20 7946 0958')).toBe('442079460958');
  });
  test('returns null for junk or missing values', () => {
    expect(normalizeStorePhone('')).toBeNull();
    expect(normalizeStorePhone(undefined)).toBeNull();
    expect(normalizeStorePhone('12')).toBeNull();
  });
});

describe('verifyStoreSignature', () => {
  const body = '{"id":1}';
  test('accepts the correct signature', () => {
    const sig = computeStoreSignature(body, 's3cret');
    expect(verifyStoreSignature(body, sig, 's3cret')).toBe(true);
  });
  test('rejects a wrong secret, tampered body, or missing header', () => {
    const sig = computeStoreSignature(body, 's3cret');
    expect(verifyStoreSignature(body, sig, 'other')).toBe(false);
    expect(verifyStoreSignature('{"id":2}', sig, 's3cret')).toBe(false);
    expect(verifyStoreSignature(body, null, 's3cret')).toBe(false);
    expect(verifyStoreSignature(body, 'short', 's3cret')).toBe(false);
  });
  test('public ids are unique and URL-safe', () => {
    const a = generatePublicId();
    expect(a).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(generatePublicId()).not.toBe(a);
  });
});

describe('summariseItems', () => {
  test('summarises quantities and caps the list', () => {
    const r = summariseItems([
      { title: 'Shirt', quantity: 2 },
      { title: 'Cap', quantity: 1 },
      { title: 'Socks', quantity: 1 },
      { title: 'Belt', quantity: 1 },
    ]);
    expect(r.text).toBe('2 x Shirt, Cap, Socks +1 more');
    expect(r.count).toBe(5);
  });
});

describe('parseShopifyEvent', () => {
  const order = {
    id: 820982911946154500,
    name: '#1001',
    total_price: '1499.00',
    currency: 'INR',
    phone: null,
    customer: { first_name: 'Asha', last_name: 'Rao', phone: '9876543210' },
    checkout_token: 'tok_1',
    order_status_url: 'https://demo.myshopify.com/orders/abc',
    line_items: [{ title: 'Kurta', quantity: 1 }],
    fulfillments: [{ tracking_number: 'T123', tracking_url: 'https://track/T123' }],
  };

  test('maps orders/create to order_placed with variables', () => {
    const e = parseShopifyEvent({ ...base, topic: 'orders/create', payload: order })!;
    expect(e.trigger).toBe('order_placed');
    expect(e.phone).toBe('919876543210');
    expect(e.vars.customer_name).toBe('Asha');
    expect(e.vars.order_number).toBe('#1001');
    expect(e.vars.order_total_formatted).toBe('INR 1499.00');
    expect(e.checkoutToken).toBe('tok_1');
  });

  test('orders/fulfilled carries tracking details', () => {
    const e = parseShopifyEvent({ ...base, topic: 'orders/fulfilled', payload: order })!;
    expect(e.trigger).toBe('order_fulfilled');
    expect(e.vars.tracking_url).toBe('https://track/T123');
  });

  test('checkouts/create maps to cart_abandoned with the recovery link', () => {
    const e = parseShopifyEvent({
      ...base,
      topic: 'checkouts/create',
      payload: {
        id: 77,
        token: 'tok_9',
        phone: '+919000000001',
        abandoned_checkout_url: 'https://demo.myshopify.com/c/xyz',
        total_price: '10.00',
        currency: 'INR',
      },
    })!;
    expect(e.trigger).toBe('cart_abandoned');
    expect(e.checkoutToken).toBe('tok_9');
    expect(e.vars.checkout_url).toBe('https://demo.myshopify.com/c/xyz');
    expect(e.vars.customer_name).toBe('there');
  });

  test('dedupe key is stable per topic and id; unknown topics are ignored', () => {
    const a = parseShopifyEvent({ ...base, topic: 'orders/create', payload: order })!;
    const b = parseShopifyEvent({ ...base, topic: 'orders/create', payload: order })!;
    expect(a.dedupeKey).toBe(b.dedupeKey);
    expect(parseShopifyEvent({ ...base, topic: 'products/update', payload: order })).toBeNull();
    expect(parseShopifyEvent({ ...base, topic: 'orders/create', payload: {} })).toBeNull();
  });

  test('a missing phone yields phone null, not a crash', () => {
    const e = parseShopifyEvent({
      ...base,
      topic: 'orders/create',
      payload: { id: 5, name: '#5' },
    })!;
    expect(e.phone).toBeNull();
  });
});

describe('parseWooEvent', () => {
  const order = {
    id: 727,
    number: '727',
    status: 'processing',
    currency: 'INR',
    total: '850.00',
    order_key: 'wc_order_abc',
    billing: { first_name: 'Ravi', last_name: 'K', phone: '09876543210' },
    line_items: [{ name: 'Tea', quantity: 3 }],
  };
  const w = { ...base, shopDomain: 'shop.example.com' };

  test('order.created becomes order_placed', () => {
    const e = parseWooEvent({ ...w, topic: 'order.created', payload: order })!;
    expect(e.trigger).toBe('order_placed');
    expect(e.phone).toBe('919876543210');
    expect(e.vars.items).toBe('3 x Tea');
    expect(e.vars.order_status_url).toBe(
      'https://shop.example.com/checkout/order-received/727/?key=wc_order_abc'
    );
  });

  test('order.updated only fires order_fulfilled once status is completed', () => {
    expect(parseWooEvent({ ...w, topic: 'order.updated', payload: order })).toBeNull();
    const e = parseWooEvent({
      ...w,
      topic: 'order.updated',
      payload: { ...order, status: 'completed' },
    })!;
    expect(e.trigger).toBe('order_fulfilled');
    expect(e.dedupeKey).toBe('order_fulfilled:727');
  });
});
