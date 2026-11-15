import { describe, expect, it } from 'vitest';
import { buildEnvelope, isWebhookEvent, parseEvents } from './events';
import {
  buildSignatureHeader,
  generateWebhookSecret,
  verifySignature,
} from './signing';
import {
  assertSafeWebhookUrl,
  isPrivateAddress,
  validateWebhookUrlShape,
} from './url-safety';

describe('events', () => {
  it('recognises only the supported events', () => {
    expect(isWebhookEvent('message.received')).toBe(true);
    expect(isWebhookEvent('ping')).toBe(false);
    expect(isWebhookEvent('nope')).toBe(false);
  });

  it('defaults to every event when none is given and rejects bad lists', () => {
    const all = parseEvents(undefined);
    expect(all.ok && all.events.length).toBe(3);
    expect(parseEvents([]).ok).toBe(false);
    expect(parseEvents('message.received').ok).toBe(false);
    expect(parseEvents(['message.received', 'bogus']).ok).toBe(false);
  });

  it('drops duplicate events', () => {
    const result = parseEvents(['message.sent', 'message.sent']);
    expect(result.ok && result.events).toEqual(['message.sent']);
  });

  it('builds an envelope with a stable shape', () => {
    const envelope = buildEnvelope(
      'ping',
      't1',
      { hello: 1 },
      {
        now: new Date('2026-11-15T10:00:00Z'),
        id: 'evt-1',
      }
    );
    expect(envelope).toEqual({
      id: 'evt-1',
      type: 'ping',
      createdAt: '2026-11-15T10:00:00.000Z',
      tenantId: 't1',
      data: { hello: 1 },
    });
  });
});

describe('signing', () => {
  const secret = 'whsec_test';
  const body = '{"id":"evt-1"}';

  it('generates distinct, prefixed secrets', () => {
    const a = generateWebhookSecret();
    expect(a).toMatch(/^whsec_[0-9a-f]{48}$/);
    expect(generateWebhookSecret()).not.toBe(a);
  });

  it('verifies a signature it just built', () => {
    const header = buildSignatureHeader(secret, body, 1_800_000_000);
    expect(header).toMatch(/^t=1800000000,v1=[0-9a-f]{64}$/);
    expect(
      verifySignature(secret, body, header, { nowSeconds: 1_800_000_010 })
    ).toBe(true);
  });

  it('rejects a tampered body, wrong secret and missing or malformed headers', () => {
    const header = buildSignatureHeader(secret, body, 1_800_000_000);
    const opts = { nowSeconds: 1_800_000_000 };
    expect(verifySignature(secret, body + ' ', header, opts)).toBe(false);
    expect(verifySignature('other', body, header, opts)).toBe(false);
    expect(verifySignature(secret, body, null, opts)).toBe(false);
    expect(verifySignature(secret, body, 'garbage', opts)).toBe(false);
    expect(verifySignature(secret, body, 't=1800000000,v1=zz', opts)).toBe(
      false
    );
  });

  it('rejects a replayed request outside the tolerance window', () => {
    const header = buildSignatureHeader(secret, body, 1_800_000_000);
    expect(
      verifySignature(secret, body, header, { nowSeconds: 1_800_000_400 })
    ).toBe(false);
    expect(
      verifySignature(secret, body, header, {
        nowSeconds: 1_800_000_400,
        toleranceSeconds: 600,
      })
    ).toBe(true);
  });
});

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fd00::1',
    'fe80::1',
    '::ffff:10.0.0.1',
    'not-an-ip',
  ])('blocks %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '172.15.0.1',
    '172.32.0.1',
    '2606:4700:4700::1111',
  ])('allows public %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe('validateWebhookUrlShape', () => {
  it('accepts a public https URL', () => {
    expect(
      validateWebhookUrlShape('https://hooks.example.com/in', false).ok
    ).toBe(true);
  });

  it.each([
    'http://hooks.example.com/in',
    'ftp://hooks.example.com',
    'https://user:pass@hooks.example.com',
    'https://localhost/in',
    'https://app.localhost/in',
    'https://printer.local/in',
    'https://db.internal/in',
    'https://127.0.0.1/in',
    'https://169.254.169.254/latest',
    'https://[::1]/in',
    'not a url',
    '',
  ])('rejects %s', (url) => {
    expect(validateWebhookUrlShape(url, false).ok).toBe(false);
  });

  it('allows http and localhost only in explicit local-development mode', () => {
    expect(validateWebhookUrlShape('http://localhost:4000/hook', true).ok).toBe(
      true
    );
  });
});

describe('assertSafeWebhookUrl', () => {
  const resolveTo =
    (...addresses: string[]) =>
    async () =>
      addresses.map((address) => ({
        address,
        family: address.includes(':') ? 6 : 4,
      }));

  it('accepts a host that resolves to public addresses', async () => {
    const result = await assertSafeWebhookUrl('https://hooks.example.com/in', {
      resolver: resolveTo('93.184.216.34'),
      allowPrivate: false,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a host that resolves to a private address, even if only one of several', async () => {
    const result = await assertSafeWebhookUrl('https://evil.example.com/in', {
      resolver: resolveTo('93.184.216.34', '10.0.0.5'),
      allowPrivate: false,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects hosts that do not resolve or fail to resolve', async () => {
    expect(
      (
        await assertSafeWebhookUrl('https://nope.example.com', {
          resolver: resolveTo(),
          allowPrivate: false,
        })
      ).ok
    ).toBe(false);
    expect(
      (
        await assertSafeWebhookUrl('https://nope.example.com', {
          resolver: async () => {
            throw new Error('ENOTFOUND');
          },
          allowPrivate: false,
        })
      ).ok
    ).toBe(false);
  });

  it('skips the network check in local-development mode', async () => {
    const result = await assertSafeWebhookUrl('http://localhost:4000/hook', {
      allowPrivate: true,
    });
    expect(result.ok).toBe(true);
  });
});
