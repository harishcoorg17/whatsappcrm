import { describe, expect, it } from 'vitest';
import { isPublicIp, normalizeDataApiUrl } from './data-api-url';

describe('normalizeDataApiUrl', () => {
  it('accepts an https URL with a path', () => {
    expect(normalizeDataApiUrl('https://api.example.com/api')).toEqual({
      ok: true,
      url: 'https://api.example.com/api',
    });
  });

  it('trims whitespace and trailing slashes', () => {
    expect(normalizeDataApiUrl('  https://api.example.com/api//  ')).toEqual({
      ok: true,
      url: 'https://api.example.com/api',
    });
  });

  it('lowercases the host', () => {
    expect(normalizeDataApiUrl('https://API.Example.com')).toEqual({
      ok: true,
      url: 'https://api.example.com',
    });
  });

  it.each([
    ['empty', ''],
    ['http', 'http://api.example.com'],
    ['no scheme', 'api.example.com'],
    ['credentials', 'https://user:pass@api.example.com'],
    ['explicit port', 'https://api.example.com:8443'],
    ['query string', 'https://api.example.com/api?key=1'],
    ['fragment', 'https://api.example.com/api#x'],
    ['localhost', 'https://localhost/api'],
    ['loopback ip', 'https://127.0.0.1/api'],
    ['private ip', 'https://10.0.0.5/api'],
    ['metadata ip', 'https://169.254.169.254/latest'],
    ['ipv6 literal', 'https://[::1]/api'],
    ['single-label host', 'https://intranet/api'],
    ['.local host', 'https://printer.local/api'],
    ['.internal host', 'https://svc.internal/api'],
    ['.localhost host', 'https://app.localhost/api'],
  ])('rejects %s', (_label, input) => {
    expect(normalizeDataApiUrl(input).ok).toBe(false);
  });
});

describe('isPublicIp', () => {
  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])(
    'treats %s as public',
    (ip) => {
      expect(isPublicIp(ip)).toBe(true);
    }
  );

  it.each([
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '224.0.0.1',
    '::',
    '::1',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    'not-an-ip',
  ])('treats %s as not public', (ip) => {
    expect(isPublicIp(ip)).toBe(false);
  });

  it('treats 172.32.0.1 (outside the private /12) as public', () => {
    expect(isPublicIp('172.32.0.1')).toBe(true);
  });
});
