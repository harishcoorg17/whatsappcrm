'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Copy, KeyRound, Loader2, Trash2 } from 'lucide-react';
import { useTenant } from '@/hooks/use-tenant';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface ApiKeyRow {
  id: string;
  label: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

interface CreatedKey {
  key: string;
  id: string;
}

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function api<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
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

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : 'Never';
}

/** Create and revoke the API keys the Amstago backend uses to call this CRM. */
export function ApiKeysManager() {
  const { selectedTenant, loading: tenantLoading } = useTenant();
  const slug = selectedTenant?.slug ?? null;

  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState('Amstago backend');
  const [created, setCreated] = useState<CreatedKey | null>(null);

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    const res = await api<{ keys: ApiKeyRow[] }>(
      `/api/tenants/${slug}/api-keys`
    );
    setLoading(false);
    if (!res.ok) return void toast.error(res.error);
    setKeys(res.data.keys);
  }, [slug]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const generate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slug) return;
    setCreating(true);
    const res = await api<CreatedKey>(`/api/tenants/${slug}/api-keys`, {
      method: 'POST',
      body: JSON.stringify({ label }),
    });
    setCreating(false);
    if (!res.ok) return void toast.error(res.error);
    setCreated({ key: res.data.key, id: res.data.id });
    void load();
  };

  const copyKey = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.key);
      toast.success('API key copied');
    } catch {
      toast.error('Could not copy. Select the key and copy it manually.');
    }
  };

  const revoke = async (row: ApiKeyRow) => {
    if (!slug) return;
    if (
      !window.confirm(
        `Revoke "${row.label}" (${row.key_prefix}…)? Anything using it will stop working.`
      )
    )
      return;
    const res = await api(`/api/tenants/${slug}/api-keys?id=${row.id}`, {
      method: 'DELETE',
    });
    if (!res.ok) return void toast.error(res.error);
    setCreated((c) => (c?.id === row.id ? null : c));
    void load();
  };

  if (tenantLoading || (loading && slug)) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-slate-400">
        <Loader2 className="size-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (!slug) {
    return (
      <p className="py-10 text-sm text-slate-400">
        Set up your workspace first to create API keys.
      </p>
    );
  }

  const activeKeys = keys.filter((k) => !k.revoked_at);

  return (
    <div className="space-y-4">
      <Card className="border-slate-700 bg-slate-900 ring-0 ring-transparent">
        <CardContent className="space-y-4 pt-4">
          <div>
            <h3 className="text-sm font-medium text-white">
              Generate an API key
            </h3>
            <p className="mt-1 text-xs text-slate-400">
              For server-to-server calls, such as the Amstago backend sending
              templates and adding quote enquiries. Put the key in that
              server&apos;s{' '}
              <code className="text-slate-300">CRM_SEND_API_KEY</code>.
            </p>
          </div>

          <form onSubmit={generate} className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label className="text-xs text-slate-300">Label</Label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={60}
                className="border-slate-700 bg-slate-800 text-white"
              />
            </div>
            <Button type="submit" disabled={creating}>
              {creating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <KeyRound className="size-4" />
              )}
              Generate key
            </Button>
          </form>

          {created && (
            <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
              <p className="text-xs text-amber-300">
                Copy this key now. It is shown only once and cannot be
                recovered. If you lose it, revoke it and generate a new one.
              </p>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={created.key}
                  onFocus={(e) => e.currentTarget.select()}
                  className="border-slate-700 bg-slate-800 font-mono text-xs text-white"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={copyKey}
                  aria-label="Copy API key"
                >
                  <Copy className="size-4" />
                </Button>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setCreated(null)}
              >
                I&apos;ve saved it
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-700 bg-slate-900 ring-0 ring-transparent">
        <CardContent className="space-y-3 pt-4">
          <h3 className="text-sm font-medium text-white">
            Active keys ({activeKeys.length})
          </h3>
          {activeKeys.length === 0 ? (
            <p className="text-xs text-slate-400">No keys yet.</p>
          ) : (
            <ul className="divide-y divide-slate-800">
              {activeKeys.map((k) => (
                <li
                  key={k.id}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-white">{k.label}</p>
                    <p className="font-mono text-xs text-slate-400">
                      {k.key_prefix}… · created {formatDate(k.created_at)} ·
                      last used {formatDate(k.last_used_at)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => revoke(k)}
                    aria-label={`Revoke ${k.label}`}
                  >
                    <Trash2 className="size-4 text-red-400" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
