import { describe, expect, it } from 'vitest';
import { checkCronAuth } from './cron-auth';

const req = (headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/whatsapp/broadcast/cron', { headers });

describe('checkCronAuth', () => {
  it('fails closed when the secret is unset or empty', () => {
    expect(checkCronAuth(req({ authorization: 'Bearer x' }), undefined)).toBe('not_configured');
    expect(checkCronAuth(req({ authorization: 'Bearer ' }), '')).toBe('not_configured');
  });

  it('accepts the Vercel-style bearer secret', () => {
    expect(checkCronAuth(req({ authorization: 'Bearer s3cret' }), 's3cret')).toBe('ok');
  });

  it('accepts the x-cron-secret header', () => {
    expect(checkCronAuth(req({ 'x-cron-secret': 's3cret' }), 's3cret')).toBe('ok');
  });

  it('rejects missing, wrong and different-length secrets', () => {
    expect(checkCronAuth(req(), 's3cret')).toBe('unauthorized');
    expect(checkCronAuth(req({ authorization: 'Bearer nope!!' }), 's3cret')).toBe('unauthorized');
    expect(checkCronAuth(req({ authorization: 'Bearer s3cret-longer' }), 's3cret')).toBe('unauthorized');
  });
});
