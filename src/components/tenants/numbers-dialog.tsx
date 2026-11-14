'use client';

import { useCallback, useEffect, useState } from 'react';
import { Phone, Plus, Star } from 'lucide-react';
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

interface TenantNumber {
  id: string;
  phone_number_id: string;
  waba_id: string | null;
  label: string | null;
  display_phone_number: string | null;
  is_primary: boolean;
  status: 'active' | 'disabled';
  has_own_token: boolean;
}

interface NumbersDialogProps {
  tenant: { slug: string; name: string } | null;
  onClose: () => void;
}

const EMPTY_FORM = {
  phoneNumberId: '',
  label: '',
  wabaId: '',
  accessToken: '',
};

async function request<T>(
  url: string,
  init?: RequestInit
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
    const body = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) return { ok: false, error: body.error ?? 'Request failed' };
    return { ok: true, data: body };
  } catch {
    return { ok: false, error: 'Network error' };
  }
}

/**
 * Manage a tenant's WhatsApp numbers: add several, choose the primary,
 * disable or remove one. The primary is the default for broadcasts and for
 * conversations that have no number yet.
 */
export function NumbersDialog({ tenant, onClose }: NumbersDialogProps) {
  const [numbers, setNumbers] = useState<TenantNumber[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const slug = tenant?.slug ?? null;
  const base = slug ? `/api/tenants/${encodeURIComponent(slug)}/numbers` : null;

  const load = useCallback(async () => {
    if (!base) return;
    setLoading(true);
    const result = await request<{ numbers: TenantNumber[] }>(base);
    setLoading(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setNumbers(result.data.numbers);
  }, [base]);

  useEffect(() => {
    if (!slug) return;
    setNumbers([]);
    setForm(EMPTY_FORM);
    setShowAdvanced(false);
    void load();
  }, [slug, load]);

  const addNumber = async () => {
    if (!base) return;
    if (!form.phoneNumberId.trim()) {
      toast.error('Phone Number ID is required');
      return;
    }
    setAdding(true);
    const result = await request<{ number: TenantNumber }>(base, {
      method: 'POST',
      body: JSON.stringify({
        phoneNumberId: form.phoneNumberId.trim(),
        label: form.label.trim() || undefined,
        wabaId: form.wabaId.trim() || undefined,
        accessToken: form.accessToken.trim() || undefined,
      }),
    });
    setAdding(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('Number added');
    setForm(EMPTY_FORM);
    void load();
  };

  const patchNumber = async (
    number: TenantNumber,
    changes: { status?: 'active' | 'disabled'; isPrimary?: boolean },
    success: string
  ) => {
    if (!base) return;
    setBusyId(number.id);
    const result = await request(`${base}/${number.id}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    });
    setBusyId(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(success);
    void load();
  };

  const removeNumber = async (number: TenantNumber) => {
    if (!base) return;
    const name =
      number.label ?? number.display_phone_number ?? number.phone_number_id;
    if (
      !window.confirm(
        `Remove ${name}? Existing conversations on this number stay, but replies will use the primary number.`
      )
    ) {
      return;
    }
    setBusyId(number.id);
    const result = await request(`${base}/${number.id}`, { method: 'DELETE' });
    setBusyId(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('Number removed');
    void load();
  };

  return (
    <Dialog
      open={tenant !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-xl border-slate-800 bg-slate-950 text-white">
        <DialogHeader>
          <DialogTitle>WhatsApp numbers — {tenant?.name}</DialogTitle>
        </DialogHeader>
        <p className="-mt-2 text-xs text-slate-400">
          Every number here shares this tenant&apos;s inbox and contacts. A
          customer who writes to a number is answered from that same number.
        </p>

        <div className="space-y-2">
          {loading && numbers.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400">Loading…</p>
          ) : numbers.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400">
              No numbers yet. Add the first one below.
            </p>
          ) : (
            numbers.map((n) => (
              <div
                key={n.id}
                className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900 p-3"
              >
                <Phone className="text-primary h-4 w-4 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {n.label ?? n.display_phone_number ?? n.phone_number_id}
                    </span>
                    {n.is_primary && (
                      <span className="bg-primary/15 text-primary flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold">
                        <Star className="h-3 w-3" />
                        Primary
                      </span>
                    )}
                    {n.status === 'disabled' && (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                        Disabled
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-xs text-slate-400">
                    {n.display_phone_number
                      ? `${n.display_phone_number} · `
                      : ''}
                    ID {n.phone_number_id}
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1.5">
                  {!n.is_primary && n.status === 'active' && (
                    <button
                      onClick={() =>
                        patchNumber(
                          n,
                          { isPrimary: true },
                          'Primary number changed'
                        )
                      }
                      disabled={busyId === n.id}
                      className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:text-white disabled:opacity-50"
                    >
                      Make primary
                    </button>
                  )}
                  {!n.is_primary && (
                    <button
                      onClick={() =>
                        patchNumber(
                          n,
                          {
                            status:
                              n.status === 'active' ? 'disabled' : 'active',
                          },
                          n.status === 'active'
                            ? 'Number disabled'
                            : 'Number enabled'
                        )
                      }
                      disabled={busyId === n.id}
                      className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:text-white disabled:opacity-50"
                    >
                      {n.status === 'active' ? 'Disable' : 'Enable'}
                    </button>
                  )}
                  {!n.is_primary && (
                    <button
                      onClick={() => removeNumber(n)}
                      disabled={busyId === n.id}
                      className="rounded-md border border-red-800 px-2 py-1 text-xs text-red-400 hover:bg-red-950/40 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="space-y-2 border-t border-slate-800 pt-4">
          <p className="text-sm font-medium">Add a number</p>
          <p className="text-xs text-slate-400">
            Sign in with Facebook, then scan the QR code Meta shows with the
            WhatsApp Business app on the phone that has the number. The number
            keeps working in the app and is added to this inbox.
          </p>
          <a
            href={`/onboarding?tenant=${encodeURIComponent(tenant?.slug ?? '')}&add=1`}
            className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          >
            <Plus className="h-4 w-4" />
            Scan QR with WhatsApp Business app
          </a>
        </div>

        <div className="space-y-3 border-t border-slate-800 pt-4">
          <p className="text-sm font-medium text-slate-300">
            Or add by Phone Number ID (advanced)
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>
                Phone Number ID <span className="text-red-400">*</span>
              </Label>
              <Input
                value={form.phoneNumberId}
                onChange={(e) =>
                  setForm({ ...form, phoneNumberId: e.target.value })
                }
                placeholder="e.g. 123456789012345"
                inputMode="numeric"
                className="border-slate-700 bg-slate-900 font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Label</Label>
              <Input
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="e.g. Sales"
                maxLength={60}
                className="border-slate-700 bg-slate-900 text-sm"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-xs text-slate-400 hover:text-white"
          >
            {showAdvanced ? 'Hide' : 'Show'} WABA ID and own access token
          </button>
          {showAdvanced && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>WABA ID</Label>
                <Input
                  value={form.wabaId}
                  onChange={(e) => setForm({ ...form, wabaId: e.target.value })}
                  placeholder="Defaults to the tenant's"
                  className="border-slate-700 bg-slate-900 font-mono text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Access token</Label>
                <Input
                  type="password"
                  value={form.accessToken}
                  onChange={(e) =>
                    setForm({ ...form, accessToken: e.target.value })
                  }
                  placeholder="Defaults to the tenant's"
                  autoComplete="off"
                  className="border-slate-700 bg-slate-900 font-mono text-sm"
                />
              </div>
            </div>
          )}
          <p className="text-xs text-slate-500">
            The number is checked with Meta before it is saved. Leave the token
            empty to share this tenant&apos;s token (numbers under one business
            account normally use the same one).
          </p>
          <div className="flex justify-end">
            <Button onClick={addNumber} disabled={adding} className="gap-2">
              <Plus className="h-4 w-4" />
              {adding ? 'Verifying…' : 'Add number'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
