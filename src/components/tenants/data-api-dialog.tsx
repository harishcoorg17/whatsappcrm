'use client';

/**
 * Dialog for a tenant's backend API address (`crm_tenants.data_api_url`).
 *
 * Flows reach it through `{{api}}/…` in the "Fetch live data" node, so each
 * business can point the same flow at its own backend. The address is checked
 * here for quick feedback and again on the server, which is authoritative.
 */

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { normalizeDataApiUrl } from '@/lib/flows/data-api-url';

export interface DataApiTenant {
  slug: string;
  name: string;
  data_api_url: string | null;
}

export function DataApiDialog({
  tenant,
  onClose,
  onSaved,
}: {
  tenant: DataApiTenant | null;
  onClose: () => void;
  onSaved: (slug: string, dataApiUrl: string | null) => void;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(tenant?.data_api_url ?? '');
    setError(null);
  }, [tenant]);

  const save = async () => {
    if (!tenant) return;
    if (value.trim() !== '') {
      const check = normalizeDataApiUrl(value);
      if (!check.ok) {
        setError(check.error);
        return;
      }
    }
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(
        `/api/tenants/${encodeURIComponent(tenant.slug)}/data-api`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: value }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not save');
      toast.success(
        data.data_api_url ? 'API address saved' : 'API address cleared'
      );
      onSaved(tenant.slug, data.data_api_url ?? null);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={!!tenant}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-md border-slate-800 bg-slate-950 text-white">
        <DialogHeader>
          <DialogTitle>Backend API — {tenant?.name}</DialogTitle>
        </DialogHeader>
        <p className="-mt-2 text-xs text-slate-400">
          The address flows call for live data (tours, destinations, bookings).
          In a flow&apos;s &ldquo;Fetch live data&rdquo; step, start the URL
          with <code className="rounded bg-slate-800 px-1">{'{{api}}/'}</code>{' '}
          and it is replaced with this address.
        </p>
        <div className="mt-2 space-y-4">
          <div className="space-y-1.5">
            <Label>API address</Label>
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="https://api.yourbusiness.com/api"
              className="border-slate-700 bg-slate-900 font-mono text-sm"
            />
            <p className="text-[11px] leading-relaxed text-slate-500">
              Must be https with a public domain name (no IP address, port or
              login in the address). Leave empty to turn it off.
            </p>
            {error && <p className="text-xs text-red-400">{error}</p>}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
