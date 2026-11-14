import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { resolveTenantRoute } from './number-routing';

interface Fake {
  numbersResult: { data: unknown; error: { message: string } | null };
  tenantResult: { data: unknown };
}

function fakeDb(fake: Fake): SupabaseClient {
  const query = (result: () => unknown) => {
    const q = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => result(),
    };
    return q;
  };
  return {
    from: (table: string) =>
      table === 'crm_tenant_numbers'
        ? query(() => fake.numbersResult)
        : query(() => fake.tenantResult),
  } as unknown as SupabaseClient;
}

describe('resolveTenantRoute', () => {
  it('routes a secondary number to its tenant using the number token', async () => {
    const db = fakeDb({
      numbersResult: {
        data: {
          access_token_enc: 'enc(number)',
          crm_tenants: {
            id: 't1',
            owner_user_id: 'u1',
            access_token_enc: 'enc(tenant)',
          },
        },
        error: null,
      },
      tenantResult: { data: null },
    });
    expect(await resolveTenantRoute(db, 'N2')).toEqual({
      tenantId: 't1',
      ownerUserId: 'u1',
      accessTokenEnc: 'enc(number)',
    });
  });

  it('shares the tenant token when the number has none', async () => {
    const db = fakeDb({
      numbersResult: {
        data: {
          access_token_enc: null,
          crm_tenants: [
            { id: 't1', owner_user_id: 'u1', access_token_enc: 'enc(tenant)' },
          ],
        },
        error: null,
      },
      tenantResult: { data: null },
    });
    expect((await resolveTenantRoute(db, 'N2'))?.accessTokenEnc).toBe(
      'enc(tenant)'
    );
  });

  it('falls back to the tenant row when the numbers table errors', async () => {
    const db = fakeDb({
      numbersResult: {
        data: null,
        error: { message: 'relation does not exist' },
      },
      tenantResult: {
        data: { id: 't9', owner_user_id: 'u9', access_token_enc: 'enc(old)' },
      },
    });
    expect(await resolveTenantRoute(db, 'N1')).toEqual({
      tenantId: 't9',
      ownerUserId: 'u9',
      accessTokenEnc: 'enc(old)',
    });
  });

  it('returns null for an unknown number', async () => {
    const db = fakeDb({
      numbersResult: { data: null, error: null },
      tenantResult: { data: null },
    });
    expect(await resolveTenantRoute(db, 'NOPE')).toBeNull();
  });
});
