'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { createClient } from '@/lib/supabase/client';

interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: string;
  /** Only present for tenants read directly (owners and platform admins). */
  owner_user_id?: string | null;
}

interface TenantContextValue {
  /** True for platform admins, who can read every tenant's data. */
  isPlatformAdmin: boolean;
  tenants: Tenant[];
  selectedTenantId: string | null;
  selectedTenant: Tenant | null;
  setSelectedTenantId: (id: string | null) => void;
  loading: boolean;
}

const TenantContext = createContext<TenantContextValue>({
  isPlatformAdmin: false,
  tenants: [],
  selectedTenantId: null,
  selectedTenant: null,
  setSelectedTenantId: () => {},
  loading: true,
});

const STORAGE_KEY = 'wacrm.selected_tenant';

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenantId, _setSelectedTenantId] = useState<string | null>(
    () => {
      try {
        return localStorage.getItem(STORAGE_KEY) ?? null;
      } catch {
        return null;
      }
    }
  );
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      // Best effort: before migration 025 the function is missing, so the
      // error is ignored and the user is simply treated as a normal user.
      const { data: adminFlag } = await supabase.rpc('is_platform_admin');
      setIsPlatformAdmin(adminFlag === true);
      // Tenants the user owns (or administers), plus tenants they were added
      // to as a team member. The member lookup is a function that exists once
      // the team migration is applied; before that its error is ignored.
      const [owned, memberOf] = await Promise.all([
        supabase
          .from('crm_tenants')
          .select('id, slug, name, status, owner_user_id')
          .order('name'),
        supabase.rpc('list_member_tenants'),
      ]);
      const byId = new Map<string, Tenant>();
      for (const t of [
        ...((owned.data as Tenant[] | null) ?? []),
        ...((memberOf.data as Tenant[] | null) ?? []),
      ]) {
        byId.set(t.id, t);
      }
      setTenants(
        [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
      );
      setLoading(false);
    })();
  }, []);

  const setSelectedTenantId = useCallback((id: string | null) => {
    _setSelectedTenantId(id);
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, []);

  const selectedTenant = tenants.find((t) => t.id === selectedTenantId) ?? null;

  return (
    <TenantContext.Provider
      value={{
        isPlatformAdmin,
        tenants,
        selectedTenantId,
        selectedTenant,
        setSelectedTenantId,
        loading,
      }}
    >
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  return useContext(TenantContext);
}
