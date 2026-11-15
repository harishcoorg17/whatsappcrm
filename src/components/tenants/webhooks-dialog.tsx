'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, KeyRound, Plus, Send, Trash2, Webhook } from 'lucide-react';
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
import {
  EVENT_LABELS,
  WEBHOOK_EVENTS,
  type WebhookEventName,
} from '@/lib/webhooks/event-names';

interface Endpoint {
  id: string;
  url: string;
  description: string | null;
  events: WebhookEventName[];
  enabled: boolean;
  consecutive_failures: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  disabled_reason: string | null;
}

interface Delivery {
  id: string;
  event_type: string;
  status: 'success' | 'failed';
  http_status: number | null;
  error: string | null;
  attempt: number;
  duration_ms: number | null;
  created_at: string;
}

interface WebhooksDialogProps {
  tenant: { slug: string; name: string } | null;
  onClose: () => void;
}

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

const formatTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '—';

const VERIFY_SNIPPET = `// Node.js: verify a delivery
const crypto = require('crypto');
function verify(rawBody, header, secret) {
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=')));
  const expected = crypto.createHmac('sha256', secret)
    .update(parts.t + '.' + rawBody).digest('hex');
  const fresh = Math.abs(Date.now() / 1000 - Number(parts.t)) < 300;
  return fresh && crypto.timingSafeEqual(
    Buffer.from(parts.v1, 'hex'), Buffer.from(expected, 'hex'));
}
// Header: X-ConverMesh-Signature   Body: the raw request body`;

/**
 * Manage a tenant's outbound webhooks: ConverMesh POSTs a signed JSON event to
 * each URL when a customer messages, an agent replies or a contact is created.
 */
export function WebhooksDialog({ tenant, onClose }: WebhooksDialogProps) {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [events, setEvents] = useState<WebhookEventName[]>([...WEBHOOK_EVENTS]);
  const [secret, setSecret] = useState<{ value: string; note: string } | null>(
    null
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);

  const slug = tenant?.slug ?? null;
  const base = slug
    ? `/api/tenants/${encodeURIComponent(slug)}/webhooks`
    : null;

  const load = useCallback(async () => {
    if (!base) return;
    setLoading(true);
    const result = await request<{ endpoints: Endpoint[] }>(base);
    setLoading(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setEndpoints(result.data.endpoints);
  }, [base]);

  useEffect(() => {
    if (!slug) return;
    setEndpoints([]);
    setUrl('');
    setDescription('');
    setEvents([...WEBHOOK_EVENTS]);
    setSecret(null);
    setExpandedId(null);
    void load();
  }, [slug, load]);

  const create = async () => {
    if (!base) return;
    if (events.length === 0) {
      toast.error('Choose at least one event');
      return;
    }
    setCreating(true);
    const result = await request<{ secret: string }>(base, {
      method: 'POST',
      body: JSON.stringify({
        url: url.trim(),
        description: description.trim(),
        events,
      }),
    });
    setCreating(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setSecret({
      value: result.data.secret,
      note: 'Signing secret for the new webhook',
    });
    setUrl('');
    setDescription('');
    void load();
  };

  const patch = async (
    endpoint: Endpoint,
    changes: Record<string, unknown>,
    success: string
  ) => {
    if (!base) return null;
    setBusyId(endpoint.id);
    const result = await request<{ secret?: string }>(
      `${base}/${endpoint.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify(changes),
      }
    );
    setBusyId(null);
    if (!result.ok) {
      toast.error(result.error);
      return null;
    }
    toast.success(success);
    void load();
    return result.data;
  };

  const rotate = async (endpoint: Endpoint) => {
    if (
      !window.confirm(
        'Create a new signing secret? The old one stops working immediately.'
      )
    )
      return;
    const data = await patch(
      endpoint,
      { rotateSecret: true },
      'New secret created'
    );
    if (data?.secret)
      setSecret({ value: data.secret, note: 'New signing secret' });
  };

  const remove = async (endpoint: Endpoint) => {
    if (!base || !window.confirm(`Delete the webhook for ${endpoint.url}?`))
      return;
    setBusyId(endpoint.id);
    const result = await request(`${base}/${endpoint.id}`, {
      method: 'DELETE',
    });
    setBusyId(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('Webhook deleted');
    void load();
  };

  const test = async (endpoint: Endpoint) => {
    if (!base) return;
    setBusyId(endpoint.id);
    const result = await request<{
      ok: boolean;
      status: number | null;
      error: string | null;
    }>(`${base}/${endpoint.id}/test`, { method: 'POST' });
    setBusyId(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    if (result.data.ok)
      toast.success(`Test delivered (HTTP ${result.data.status})`);
    else toast.error(`Test failed: ${result.data.error ?? 'no response'}`);
    void load();
  };

  const toggleDeliveries = async (endpoint: Endpoint) => {
    if (!base) return;
    if (expandedId === endpoint.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(endpoint.id);
    setDeliveries([]);
    const result = await request<{ deliveries: Delivery[] }>(
      `${base}/${endpoint.id}`
    );
    if (result.ok) setDeliveries(result.data.deliveries);
    else toast.error(result.error);
  };

  const toggleEvent = (name: WebhookEventName) =>
    setEvents((current) =>
      current.includes(name)
        ? current.filter((e) => e !== name)
        : [...current, name]
    );

  return (
    <Dialog
      open={tenant !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto border-slate-800 bg-slate-950 text-white">
        <DialogHeader>
          <DialogTitle>Webhooks — {tenant?.name}</DialogTitle>
        </DialogHeader>
        <p className="-mt-2 text-xs text-slate-400">
          We send a signed JSON event to each URL when something happens, so
          your own systems, Zapier or Make can react. Failed deliveries are
          retried three times, and a webhook that fails 10 times in a row is
          switched off.
        </p>

        {secret && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
            <p className="text-sm font-medium text-amber-300">{secret.note}</p>
            <p className="mt-1 text-xs text-amber-200/80">
              Copy it now. It is shown only once and cannot be read back later.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-slate-900 px-2 py-1.5 font-mono text-xs text-white">
                {secret.value}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(secret.value);
                  toast.success('Copied');
                }}
                className="gap-1.5"
              >
                <Copy className="h-3.5 w-3.5" />
                Copy
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSecret(null)}>
                Done
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {loading && endpoints.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400">Loading…</p>
          ) : endpoints.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400">
              No webhooks yet. Add your first URL below.
            </p>
          ) : (
            endpoints.map((e) => (
              <div
                key={e.id}
                className="rounded-lg border border-slate-800 bg-slate-900 p-3"
              >
                <div className="flex items-start gap-3">
                  <Webhook className="text-primary mt-0.5 h-4 w-4 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-mono text-sm">
                        {e.url}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          e.enabled
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : 'bg-amber-500/15 text-amber-400'
                        }`}
                      >
                        {e.enabled ? 'Active' : 'Off'}
                      </span>
                    </div>
                    {e.description && (
                      <p className="mt-0.5 text-xs text-slate-400">
                        {e.description}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-slate-500">
                      {e.events.map((n) => EVENT_LABELS[n] ?? n).join(' · ')}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Last success {formatTime(e.last_success_at)} · last
                      failure {formatTime(e.last_failure_at)}
                    </p>
                    {e.disabled_reason && (
                      <p className="mt-1 text-xs text-amber-400">
                        {e.disabled_reason}
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <button
                    onClick={() => test(e)}
                    disabled={busyId === e.id}
                    className="flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:text-white disabled:opacity-50"
                  >
                    <Send className="h-3 w-3" />
                    Send test
                  </button>
                  <button
                    onClick={() => toggleDeliveries(e)}
                    className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:text-white"
                  >
                    {expandedId === e.id
                      ? 'Hide deliveries'
                      : 'Recent deliveries'}
                  </button>
                  <button
                    onClick={() =>
                      patch(
                        e,
                        { enabled: !e.enabled },
                        e.enabled ? 'Webhook turned off' : 'Webhook turned on'
                      )
                    }
                    disabled={busyId === e.id}
                    className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:text-white disabled:opacity-50"
                  >
                    {e.enabled ? 'Turn off' : 'Turn on'}
                  </button>
                  <button
                    onClick={() => rotate(e)}
                    disabled={busyId === e.id}
                    className="flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:text-white disabled:opacity-50"
                  >
                    <KeyRound className="h-3 w-3" />
                    New secret
                  </button>
                  <button
                    onClick={() => remove(e)}
                    disabled={busyId === e.id}
                    aria-label={`Delete webhook ${e.url}`}
                    className="ml-auto rounded-md border border-red-800 p-1 text-red-400 hover:bg-red-950/40 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {expandedId === e.id && (
                  <div className="mt-3 overflow-x-auto rounded-md border border-slate-800">
                    {deliveries.length === 0 ? (
                      <p className="p-3 text-xs text-slate-500">
                        No deliveries yet.
                      </p>
                    ) : (
                      <table className="w-full text-xs">
                        <tbody className="divide-y divide-slate-800">
                          {deliveries.map((d) => (
                            <tr key={d.id}>
                              <td className="px-2 py-1.5 whitespace-nowrap text-slate-400">
                                {formatTime(d.created_at)}
                              </td>
                              <td className="px-2 py-1.5 font-mono text-slate-300">
                                {d.event_type}
                              </td>
                              <td
                                className={`px-2 py-1.5 ${d.status === 'success' ? 'text-emerald-400' : 'text-red-400'}`}
                              >
                                {d.status === 'success'
                                  ? `OK ${d.http_status ?? ''}`
                                  : (d.error ?? 'Failed')}
                              </td>
                              <td className="px-2 py-1.5 text-right text-slate-500">
                                try {d.attempt}
                                {d.duration_ms !== null
                                  ? ` · ${d.duration_ms} ms`
                                  : ''}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div className="space-y-3 border-t border-slate-800 pt-4">
          <p className="text-sm font-medium">Add a webhook</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>
                URL <span className="text-red-400">*</span>
              </Label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://hooks.example.com/convermesh"
                autoComplete="off"
                className="border-slate-700 bg-slate-900 font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Zapier lead sync"
                maxLength={120}
                className="border-slate-700 bg-slate-900 text-sm"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            {WEBHOOK_EVENTS.map((name) => (
              <label key={name} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={events.includes(name)}
                  onChange={() => toggleEvent(name)}
                  className="accent-primary h-4 w-4"
                />
                <span className="font-mono text-xs text-slate-400">{name}</span>
                <span className="text-slate-300">{EVENT_LABELS[name]}</span>
              </label>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            The URL must be https and reachable from the internet.
          </p>
          <div className="flex justify-end">
            <Button
              onClick={create}
              disabled={creating || !url.trim()}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              {creating ? 'Adding…' : 'Add webhook'}
            </Button>
          </div>

          <details className="text-xs text-slate-400">
            <summary className="cursor-pointer text-slate-300">
              How to verify a delivery
            </summary>
            <pre className="mt-2 overflow-x-auto rounded-md bg-slate-900 p-3 text-[11px] text-slate-300">
              {VERIFY_SNIPPET}
            </pre>
          </details>
        </div>
      </DialogContent>
    </Dialog>
  );
}
