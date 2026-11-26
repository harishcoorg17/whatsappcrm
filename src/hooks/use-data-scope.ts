'use client';

import { useMemo } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useTenant } from '@/hooks/use-tenant';

/**
 * Which rows a page should load.
 *
 * Platform admins can read every tenant's data (migration 057), so a page that
 * relies on row level security alone would show all tenants mixed together.
 * This says how to narrow the query:
 *  - viewing another tenant: that tenant's rows only, read-only;
 *  - admin with no other tenant picked: the admin's own rows only;
 *  - everyone else: nothing extra, row level security already limits them.
 */
export interface DataScope {
  /** An admin is looking at a tenant that is not their own: no changes. */
  isViewOnly: boolean;
  tenantName: string | null;
  /** PostgREST `or` filter matching the viewed tenant's rows, if any. */
  tenantFilter: string | null;
  /** Restrict to this user's rows (admin with no other tenant picked). */
  ownUserId: string | null;
}

export const NO_SCOPE: DataScope = {
  isViewOnly: false,
  tenantName: null,
  tenantFilter: null,
  ownUserId: null,
};

export function computeDataScope(input: {
  isPlatformAdmin: boolean;
  userId: string | null;
  tenant: { id: string; name: string; owner_user_id?: string | null } | null;
}): DataScope {
  const { isPlatformAdmin, userId, tenant } = input;
  if (!isPlatformAdmin || !userId) return NO_SCOPE;

  const ownerId = tenant?.owner_user_id;
  if (tenant && ownerId && ownerId !== userId) {
    // Rows are filed under the tenant id and, on older data, its owner.
    return {
      isViewOnly: true,
      tenantName: tenant.name,
      tenantFilter: `tenant_id.eq.${tenant.id},user_id.eq.${ownerId}`,
      ownUserId: null,
    };
  }
  return { ...NO_SCOPE, ownUserId: userId };
}

/** Narrows a Supabase select/update query to the scope. */
export function applyDataScope<
  Q extends {
    or: (filter: string) => Q;
    eq: (column: string, value: string) => Q;
  },
>(query: Q, scope: DataScope): Q {
  if (scope.tenantFilter) return query.or(scope.tenantFilter);
  if (scope.ownUserId) return query.eq('user_id', scope.ownUserId);
  return query;
}

export function useDataScope(): DataScope {
  const { user } = useAuth();
  const { isPlatformAdmin, selectedTenant } = useTenant();
  const userId = user?.id ?? null;
  return useMemo(
    () => computeDataScope({ isPlatformAdmin, userId, tenant: selectedTenant }),
    [isPlatformAdmin, userId, selectedTenant]
  );
}
