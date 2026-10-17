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
}

interface TenantContextValue {
  tenants: Tenant[];
  selectedTenantId: string | null;
  selectedTenant: Tenant | null;
  setSelectedTenantId: (id: string | null) => void;
  loading: boolean;
}

const TenantContext = createContext<TenantContextValue>({
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from('crm_tenants')
      .select('id, slug, name, status')
      .order('name')
      .then(({ data }) => {
        setTenants(data ?? []);
        setLoading(false);
      });
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
      value={{ tenants, selectedTenantId, selectedTenant, setSelectedTenantId, loading }}
    >
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  return useContext(TenantContext);
}
