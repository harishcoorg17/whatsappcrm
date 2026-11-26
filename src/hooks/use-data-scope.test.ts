import { describe, expect, it, vi } from 'vitest';
import {
  applyDataScope,
  computeDataScope,
  NO_SCOPE,
  type DataScope,
} from './use-data-scope';

const tenant = {
  id: 'tenant-1',
  name: 'Acme Travel',
  owner_user_id: 'owner-1',
};

describe('computeDataScope', () => {
  it('adds no extra filter for a normal user', () => {
    const scope = computeDataScope({
      isPlatformAdmin: false,
      userId: 'owner-1',
      tenant,
    });

    expect(scope).toEqual(NO_SCOPE);
  });

  it('makes an admin viewing another tenant read-only and tenant-scoped', () => {
    const scope = computeDataScope({
      isPlatformAdmin: true,
      userId: 'admin-1',
      tenant,
    });

    expect(scope.isViewOnly).toBe(true);
    expect(scope.tenantName).toBe('Acme Travel');
    expect(scope.tenantFilter).toBe('tenant_id.eq.tenant-1,user_id.eq.owner-1');
    expect(scope.ownUserId).toBeNull();
  });

  it('limits an admin with no tenant picked to their own rows', () => {
    const scope = computeDataScope({
      isPlatformAdmin: true,
      userId: 'admin-1',
      tenant: null,
    });

    expect(scope.isViewOnly).toBe(false);
    expect(scope.ownUserId).toBe('admin-1');
  });

  it('treats an admin viewing their own tenant as editable and own-scoped', () => {
    const scope = computeDataScope({
      isPlatformAdmin: true,
      userId: 'owner-1',
      tenant,
    });

    expect(scope.isViewOnly).toBe(false);
    expect(scope.ownUserId).toBe('owner-1');
  });

  it('does not treat a tenant without a known owner as viewable', () => {
    const scope = computeDataScope({
      isPlatformAdmin: true,
      userId: 'admin-1',
      tenant: { id: 'tenant-2', name: 'No Owner', owner_user_id: null },
    });

    expect(scope.isViewOnly).toBe(false);
    expect(scope.tenantFilter).toBeNull();
  });
});

describe('applyDataScope', () => {
  function fakeQuery() {
    const query = {
      or: vi.fn(() => query),
      eq: vi.fn(() => query),
    };
    return query;
  }

  it('applies the tenant filter when viewing a tenant', () => {
    const query = fakeQuery();
    const scope: DataScope = {
      ...NO_SCOPE,
      isViewOnly: true,
      tenantFilter: 'tenant_id.eq.t1,user_id.eq.o1',
    };

    applyDataScope(query, scope);

    expect(query.or).toHaveBeenCalledWith('tenant_id.eq.t1,user_id.eq.o1');
    expect(query.eq).not.toHaveBeenCalled();
  });

  it('restricts to own rows when only ownUserId is set', () => {
    const query = fakeQuery();

    applyDataScope(query, { ...NO_SCOPE, ownUserId: 'admin-1' });

    expect(query.eq).toHaveBeenCalledWith('user_id', 'admin-1');
    expect(query.or).not.toHaveBeenCalled();
  });

  it('leaves the query alone with no scope', () => {
    const query = fakeQuery();

    applyDataScope(query, NO_SCOPE);

    expect(query.or).not.toHaveBeenCalled();
    expect(query.eq).not.toHaveBeenCalled();
  });
});
