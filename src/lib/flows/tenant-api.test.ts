import { beforeEach, describe, expect, it, vi } from 'vitest';

const lookupMock = vi.fn();
vi.mock('node:dns/promises', () => ({
  lookup: (...args: unknown[]) => lookupMock(...args),
}));

import { loadTenantApiBase, publicHostGuard } from './tenant-api';

interface FakeRows {
  conversation: { tenant_id: string | null } | null;
  tenant: { data_api_url: string | null } | null;
}

function fakeDb(rows: FakeRows) {
  return {
    from: (table: string) => {
      const row = table === 'conversations' ? rows.conversation : rows.tenant;
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: row, error: null }),
      };
      return query;
    },
  } as never;
}

beforeEach(() => {
  lookupMock.mockReset();
});

describe('loadTenantApiBase', () => {
  it("returns the tenant's normalised API base", async () => {
    const db = fakeDb({
      conversation: { tenant_id: 't1' },
      tenant: { data_api_url: 'https://API.example.com/api/' },
    });
    expect(await loadTenantApiBase(db, 'c1')).toBe(
      'https://api.example.com/api'
    );
  });

  it('returns null when there is no conversation id', async () => {
    const db = fakeDb({ conversation: null, tenant: null });
    expect(await loadTenantApiBase(db, null)).toBeNull();
  });

  it('returns null for a conversation without a tenant', async () => {
    const db = fakeDb({
      conversation: { tenant_id: null },
      tenant: { data_api_url: 'https://api.example.com' },
    });
    expect(await loadTenantApiBase(db, 'c1')).toBeNull();
  });

  it('returns null when the tenant has no API configured', async () => {
    const db = fakeDb({
      conversation: { tenant_id: 't1' },
      tenant: { data_api_url: null },
    });
    expect(await loadTenantApiBase(db, 'c1')).toBeNull();
  });

  it('ignores a stored value that breaks the URL rules', async () => {
    const db = fakeDb({
      conversation: { tenant_id: 't1' },
      tenant: { data_api_url: 'https://169.254.169.254/latest' },
    });
    expect(await loadTenantApiBase(db, 'c1')).toBeNull();
  });
});

describe('publicHostGuard', () => {
  it('approves a host that resolves only to public addresses', async () => {
    lookupMock.mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ]);
    expect(await publicHostGuard('api.example.com')).toBe(true);
    expect(lookupMock).toHaveBeenCalledWith('api.example.com', { all: true });
  });

  it('rejects a host if any address is private', async () => {
    lookupMock.mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.7', family: 4 },
    ]);
    expect(await publicHostGuard('rebind.example.com')).toBe(false);
  });

  it('rejects a host that resolves to loopback', async () => {
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    expect(await publicHostGuard('local.example.com')).toBe(false);
  });

  it('rejects a host that does not resolve', async () => {
    lookupMock.mockRejectedValue(new Error('ENOTFOUND'));
    expect(await publicHostGuard('missing.example.com')).toBe(false);
  });

  it('rejects an empty answer', async () => {
    lookupMock.mockResolvedValue([]);
    expect(await publicHostGuard('empty.example.com')).toBe(false);
  });
});
