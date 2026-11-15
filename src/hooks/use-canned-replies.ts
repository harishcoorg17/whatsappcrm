'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { CannedReply } from '@/lib/canned-replies';

/**
 * Quick replies available while working one tenant: that tenant's own plus the
 * all-tenant ones. When both define the same shortcut the tenant's wins.
 * Row level security limits this to what the user may read, so an agent sees
 * the team's shared replies. Fails quietly (no replies) if the table is not
 * there yet.
 */
export function useCannedReplies(
  tenantId: string | null | undefined,
  refreshKey = 0
): CannedReply[] {
  const [replies, setReplies] = useState<CannedReply[]>([]);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      let query = supabase
        .from('canned_replies')
        .select('id, shortcut, title, body, tenant_id')
        .order('shortcut', { ascending: true });
      if (tenantId) {
        query = query.or(`tenant_id.eq.${tenantId},tenant_id.is.null`);
      }
      const { data, error } = await query;
      if (cancelled) return;
      if (error) {
        console.warn('[inbox] could not load quick replies:', error.message);
        setReplies([]);
        return;
      }
      const byShortcut = new Map<string, CannedReply>();
      for (const row of (data ?? []) as CannedReply[]) {
        const existing = byShortcut.get(row.shortcut);
        // A tenant-specific reply beats an all-tenant one with the same name.
        if (
          !existing ||
          (existing.tenant_id === null && row.tenant_id !== null)
        ) {
          byShortcut.set(row.shortcut, row);
        }
      }
      setReplies([...byShortcut.values()]);
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, refreshKey]);

  return replies;
}
