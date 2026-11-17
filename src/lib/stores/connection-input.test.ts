import { describe, expect, test } from 'vitest';
import { cleanShopDomain, parseConnectionInput } from './connection-input';

describe('cleanShopDomain', () => {
  test('strips scheme, path and case', () => {
    expect(cleanShopDomain(' HTTPS://Shop.Example.com/admin ')).toBe('shop.example.com');
  });
});

describe('parseConnectionInput', () => {
  test('shopify needs a signing key', () => {
    const r = parseConnectionInput({ platform: 'shopify', shopDomain: 'a.myshopify.com', secret: '' });
    expect(r.ok).toBe(false);
  });
  test('shopify with key is accepted with defaults', () => {
    const r = parseConnectionInput({ platform: 'shopify', shopDomain: 'a.myshopify.com', secret: 'abcdefgh1234' });
    expect(r.ok && r.value.abandonedAfterMinutes).toBe(60);
    expect(r.ok && r.value.defaultCountryCode).toBe('91');
  });
  test('woocommerce generates its own secret (none required)', () => {
    const r = parseConnectionInput({ platform: 'woocommerce', shopDomain: 'https://shop.example.com/' });
    expect(r.ok && r.value.secret).toBeNull();
    expect(r.ok && r.value.shopDomain).toBe('shop.example.com');
  });
  test('rejects bad platform, domain and wait time', () => {
    expect(parseConnectionInput({ platform: 'x', shopDomain: 'a.com' }).ok).toBe(false);
    expect(parseConnectionInput({ platform: 'woocommerce', shopDomain: 'nodot' }).ok).toBe(false);
    expect(parseConnectionInput({ platform: 'woocommerce', shopDomain: 'a.com', abandonedAfterMinutes: 1 }).ok).toBe(false);
  });
});
