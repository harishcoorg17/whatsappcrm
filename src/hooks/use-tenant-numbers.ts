'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export interface TenantNumberSummary {
  tenant_id: string;
  phone_number_id: string;
  label: string | null;
  display_phone_number: string | null;
}

/** Human name for a number: its label, else the phone number, else its id. */
export function numberDisplayName(n: TenantNumberSummary): string {
  return n.label ?? n.display_phone_number ?? n.phone_number_id;
}

/**
 * The WhatsApp numbers the signed-in user can see, for labelling conversations
 * and filtering the inbox by number. Row level security already limits this to
 * the user's own tenants (or every tenant for a platform admin). Only label
 * columns are selected, never tokens. Fails quietly: without numbers the inbox
 * just shows no number badges.
 */
export function useTenantNumbers(refreshKey = 0) {
  const [numbers, setNumbers] = useState<TenantNumberSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      const { data, error } = await supabase
        .from('crm_tenant_numbers')
        .select('tenant_id, phone_number_id, label, display_phone_number')
        .eq('status', 'active')
        .order('created_at', { ascending: true });
      if (cancelled) return;
      if (error) {
        // Table missing (migration 028 not applied) or no access: no badges.
        console.warn('[inbox] could not load tenant numbers:', error.message);
        return;
      }
      setNumbers((data ?? []) as TenantNumberSummary[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return useMemo(() => {
    const byPhoneId = new Map<string, TenantNumberSummary>();
    const countByTenant = new Map<string, number>();
    for (const n of numbers) {
      byPhoneId.set(n.phone_number_id, n);
      countByTenant.set(n.tenant_id, (countByTenant.get(n.tenant_id) ?? 0) + 1);
    }
    return { numbers, byPhoneId, countByTenant };
  }, [numbers]);
}
