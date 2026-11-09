import { describe, expect, it } from 'vitest';
import { accountIdsFromDebugToken } from './granted-accounts';

describe('accountIdsFromDebugToken', () => {
  it('collects account ids from both WhatsApp permissions without duplicates', () => {
    const ids = accountIdsFromDebugToken(
      {
        data: {
          is_valid: true,
          app_id: 'app1',
          granular_scopes: [
            { scope: 'whatsapp_business_management', target_ids: ['a1', 'a2'] },
            { scope: 'whatsapp_business_messaging', target_ids: ['a2', 'a3'] },
            { scope: 'business_management', target_ids: ['biz1'] },
          ],
        },
      },
      'app1'
    );
    expect(ids).toEqual(['a1', 'a2', 'a3']);
  });

  it('returns an empty list when the token carries no WhatsApp accounts', () => {
    expect(
      accountIdsFromDebugToken(
        { data: { is_valid: true, app_id: 'app1', granular_scopes: [] } },
        'app1'
      )
    ).toEqual([]);
  });

  it('refuses a token issued to a different app', () => {
    expect(
      accountIdsFromDebugToken(
        {
          data: {
            is_valid: true,
            app_id: 'other',
            granular_scopes: [
              { scope: 'whatsapp_business_management', target_ids: ['a1'] },
            ],
          },
        },
        'app1'
      )
    ).toBeNull();
  });

  it('refuses an invalid token or an empty response', () => {
    expect(
      accountIdsFromDebugToken(
        { data: { is_valid: false, app_id: 'app1' } },
        'app1'
      )
    ).toBeNull();
    expect(accountIdsFromDebugToken({}, 'app1')).toBeNull();
  });
});
