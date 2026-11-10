'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  Plus,
  Building2,
  CheckCircle,
  XCircle,
  Clock,
  ExternalLink,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { toast, Toaster } from 'sonner';
import { DataApiDialog } from '@/components/tenants/data-api-dialog';

interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'suspended' | 'pending';
  plan: string;
  waba_id: string | null;
  phone_number_id: string | null;
  data_api_url: string | null;
  created_at: string;
}

const STATUS_COLORS = {
  active: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  suspended: 'bg-red-500/15 text-red-400 border-red-500/30',
  pending: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
};
const STATUS_ICONS = {
  active: CheckCircle,
  suspended: XCircle,
  pending: Clock,
};

interface EditCreds {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  wabaId: string;
  phoneNumberId: string;
  accessToken: string;
}

export default function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: '', slug: '', plan: 'starter' });
  const [saving, setSaving] = useState(false);
  const [editCreds, setEditCreds] = useState<EditCreds | null>(null);
  const [apiTenant, setApiTenant] = useState<Tenant | null>(null);
  const [savingCreds, setSavingCreds] = useState(false);
  const [syncingSlug, setSyncingSlug] = useState<string | null>(null);
  // Tenants connected through WhatsApp coexistence, which can import phone data.
  const [coexistenceIds, setCoexistenceIds] = useState<Set<string>>(new Set());
  const [syncingPhoneSlug, setSyncingPhoneSlug] = useState<string | null>(null);
  const supabase = createClient();

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('crm_tenants')
      .select(
        'id,slug,name,status,plan,waba_id,phone_number_id,data_api_url,created_at'
      )
      .order('created_at', { ascending: false });
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    setTenants(data ?? []);

    // Best effort: without it the phone-sync button just stays hidden.
    const { data: events } = await supabase
      .from('embedded_signup_events')
      .select('tenant_id')
      .eq('event_type', 'completed_coexistence');
    setCoexistenceIds(
      new Set((events ?? []).map((e: { tenant_id: string }) => e.tenant_id))
    );
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const createTenant = async () => {
    if (!form.name || !form.slug) {
      toast.error('Name and slug are required');
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('crm_tenants').insert({
      name: form.name,
      slug: form.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      plan: form.plan,
      status: 'pending',
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Tenant created');
    setShowNew(false);
    setForm({ name: '', slug: '', plan: 'starter' });
    load();
  };

  const openEditCreds = (t: Tenant) => {
    setEditCreds({
      tenantId: t.id,
      tenantSlug: t.slug,
      tenantName: t.name,
      wabaId: t.waba_id ?? '',
      phoneNumberId: t.phone_number_id ?? '',
      accessToken: '',
    });
  };

  const saveCredentials = async () => {
    if (!editCreds) return;
    // With a token the server finds the WhatsApp Business Account itself, so
    // only the phone number id is needed. Without one, both ids are required.
    const hasToken = editCreds.accessToken.trim().length > 0;
    if (
      !editCreds.phoneNumberId.trim() ||
      (!hasToken && !editCreds.wabaId.trim())
    ) {
      toast.error(
        hasToken
          ? 'Phone Number ID is required'
          : 'WABA ID and Phone Number ID are required'
      );
      return;
    }
    setSavingCreds(true);
    try {
      // If an access token is provided, route through the ES API so it gets
      // encrypted and owner_user_id is captured. Otherwise just update the IDs.
      if (editCreds.accessToken.trim()) {
        const res = await fetch('/api/whatsapp/embedded-signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: null,
            tenantSlug: editCreds.tenantSlug,
            wabaId: editCreds.wabaId.trim(),
            phoneNumberId: editCreds.phoneNumberId.trim(),
            accessToken: editCreds.accessToken.trim(),
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          // No fallback to a direct write: that would mark the tenant active
          // with IDs Meta never verified and no stored token.
          toast.error(data.error ?? 'Could not verify these credentials');
          return;
        }
        toast.success('Credentials saved and encrypted');
        setEditCreds(null);
        load();
        return;
      }
      // Direct update for waba_id / phone_number_id without token
      const { error } = await supabase
        .from('crm_tenants')
        .update({
          waba_id: editCreds.wabaId.trim(),
          phone_number_id: editCreds.phoneNumberId.trim(),
        })
        .eq('id', editCreds.tenantId);
      if (error) {
        toast.error(error.message);
        return;
      }
      // Without a token nothing is verified or subscribed, so the tenant must
      // not be marked active: it could not send, and the webhook would drop
      // its inbound messages.
      toast.warning('IDs saved. Add an access token to activate this tenant.');
      setEditCreds(null);
      load();
    } finally {
      setSavingCreds(false);
    }
  };

  // Meta sends inbound messages to a phone-number or account override before
  // the app callback, so a leftover override can hide messages from this CRM.
  const syncWebhook = async (t: Tenant) => {
    setSyncingSlug(t.slug);
    try {
      const res = await fetch('/api/whatsapp/webhook-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantSlug: t.slug }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Could not check the webhook');
        return;
      }
      const subs: Array<{ status: string; error?: string }> =
        data.subscriptions ?? [];
      const added = subs.filter((s) => s.status === 'subscribed').length;
      const failed = subs.filter((s) => s.status === 'failed');

      const parts: string[] = [];
      if (data.changed.phone || data.changed.waba) {
        const previous = data.before.phone ?? data.before.waba;
        parts.push(`Messages now go to ${data.webhookUrl} (was ${previous}).`);
      } else {
        parts.push('No competing webhook override found.');
      }
      if (added > 0) {
        parts.push(`Subscribed this app on ${added} more account(s).`);
      } else if (subs.length > 0) {
        parts.push(
          `App already subscribed on ${subs.length - failed.length} account(s).`
        );
      }
      if (failed.length > 0) {
        parts.push(`${failed.length} account(s) could not be checked.`);
      }

      const message = parts.join(' ');
      if (failed.length > 0) toast.warning(message);
      else toast.success(message);
    } catch {
      toast.error('Could not reach the server');
    } finally {
      setSyncingSlug(null);
    }
  };

  const callPhoneSync = async (slug: string, sync: 'contacts' | 'history') => {
    const res = await fetch('/api/whatsapp/coexistence-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantSlug: slug, sync }),
    });
    const data = await res.json();
    return {
      ok: res.ok,
      status: res.status,
      error: data.error as string | undefined,
    };
  };

  // Meta allows each import once, contacts first, within 24 hours of connecting.
  const syncPhoneData = async (t: Tenant) => {
    const proceed = window.confirm(
      `Import the WhatsApp Business app contacts and chat history for ${t.name}?\n\n` +
        'Meta allows this only ONCE, within 24 hours of connecting this number, and it cannot be repeated. ' +
        'Keep the WhatsApp Business app open on the phone until it finishes.'
    );
    if (!proceed) return;

    setSyncingPhoneSlug(t.slug);
    try {
      // 409 means that step was already requested, so carry on to the next.
      const contacts = await callPhoneSync(t.slug, 'contacts');
      if (!contacts.ok && contacts.status !== 409) {
        toast.error(contacts.error ?? 'Could not request the contacts sync');
        return;
      }
      const history = await callPhoneSync(t.slug, 'history');
      if (!history.ok && history.status !== 409) {
        toast.error(history.error ?? 'Could not request the history sync');
        return;
      }
      toast.success(
        'Sync requested. Contacts and chats will arrive over the next few minutes.'
      );
    } catch {
      toast.error('Could not reach the server');
    } finally {
      setSyncingPhoneSlug(null);
    }
  };

  const toggleStatus = async (t: Tenant) => {
    const next = t.status === 'active' ? 'suspended' : 'active';
    const { error } = await supabase
      .from('crm_tenants')
      .update({ status: next })
      .eq('id', t.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Tenant ${next}`);
    load();
  };

  const filtered = tenants.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.slug.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="mx-auto max-w-5xl p-6">
      <Toaster richColors />
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Tenants</h1>
          <p className="mt-0.5 text-sm text-slate-400">
            Manage all Novacompass WhatsApp CRM tenants
          </p>
        </div>
        <Button onClick={() => setShowNew(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          New Tenant
        </Button>
      </div>

      <div className="relative mb-4">
        <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or slug…"
          className="border-slate-700 bg-slate-900 pl-9 text-white placeholder-slate-500"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="border-primary h-8 w-8 animate-spin rounded-full border-b-2" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-slate-500">
          <Building2 className="h-12 w-12 opacity-30" />
          <p className="text-sm">
            {search ? 'No tenants match your search' : 'No tenants yet'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((t) => {
            const Icon = STATUS_ICONS[t.status];
            return (
              <div
                key={t.id}
                className="flex items-center gap-4 rounded-xl border border-slate-800 bg-slate-900 p-4"
              >
                <div className="bg-primary/10 border-primary/20 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border">
                  <Building2 className="text-primary h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-white">{t.name}</p>
                    <span
                      className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[t.status]}`}
                    >
                      <Icon className="h-3 w-3" />
                      {t.status}
                    </span>
                    <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-500">
                      {t.plan}
                    </span>
                  </div>
                  <p className="mt-0.5 font-mono text-sm text-slate-400">
                    /{t.slug}
                  </p>
                  <div className="mt-1 flex items-center gap-4">
                    {t.waba_id ? (
                      <span className="text-xs text-slate-500">
                        WABA: {t.waba_id}
                      </span>
                    ) : t.status === 'active' ? (
                      <span className="text-xs text-sky-400">
                        Connected — set WABA credentials
                      </span>
                    ) : (
                      <span className="text-xs text-amber-500">
                        WhatsApp not connected
                      </span>
                    )}
                    <span className="text-xs text-slate-600">
                      Created {new Date(t.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <button
                    onClick={() => openEditCreds(t)}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 transition-colors hover:border-slate-600 hover:text-white"
                  >
                    {t.waba_id ? 'Edit credentials' : 'Set credentials'}
                  </button>
                  <button
                    onClick={() => setApiTenant(t)}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 transition-colors hover:border-slate-600 hover:text-white"
                  >
                    {t.data_api_url ? 'Backend API ✓' : 'Backend API'}
                  </button>
                  <a
                    href={`/onboarding?tenant=${t.slug}`}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 transition-colors hover:border-slate-600 hover:text-white"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t.waba_id ? 'Re-connect' : 'Connect WA'}
                  </a>
                  {t.waba_id && (
                    <button
                      onClick={() => syncWebhook(t)}
                      disabled={syncingSlug === t.slug}
                      className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 transition-colors hover:border-slate-600 hover:text-white disabled:opacity-50"
                    >
                      {syncingSlug === t.slug ? 'Checking…' : 'Fix webhook'}
                    </button>
                  )}
                  {coexistenceIds.has(t.id) && (
                    <button
                      onClick={() => syncPhoneData(t)}
                      disabled={syncingPhoneSlug === t.slug}
                      className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 transition-colors hover:border-slate-600 hover:text-white disabled:opacity-50"
                    >
                      {syncingPhoneSlug === t.slug
                        ? 'Requesting…'
                        : 'Sync phone data'}
                    </button>
                  )}
                  <button
                    onClick={() => toggleStatus(t)}
                    className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                      t.status === 'active'
                        ? 'border-red-800 text-red-400 hover:bg-red-950/40'
                        : 'border-emerald-800 text-emerald-400 hover:bg-emerald-950/40'
                    }`}
                  >
                    {t.status === 'active' ? 'Suspend' : 'Activate'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <DataApiDialog
        tenant={apiTenant}
        onClose={() => setApiTenant(null)}
        onSaved={(slug, dataApiUrl) =>
          setTenants((current) =>
            current.map((t) =>
              t.slug === slug ? { ...t, data_api_url: dataApiUrl } : t
            )
          )
        }
      />

      {/* Edit credentials dialog */}
      <Dialog
        open={!!editCreds}
        onOpenChange={(open) => {
          if (!open) setEditCreds(null);
        }}
      >
        <DialogContent className="max-w-md border-slate-800 bg-slate-950 text-white">
          <DialogHeader>
            <DialogTitle>
              WhatsApp Credentials — {editCreds?.tenantName}
            </DialogTitle>
          </DialogHeader>
          <p className="-mt-2 text-xs text-slate-400">
            Paste your WABA ID and Phone Number ID from Meta Business Manager.
            Optionally paste a System User access token to store it encrypted.
          </p>
          <div className="mt-2 space-y-4">
            <div className="space-y-1.5">
              <Label>
                WABA ID <span className="text-red-400">*</span>
              </Label>
              <Input
                value={editCreds?.wabaId ?? ''}
                onChange={(e) =>
                  setEditCreds((c) =>
                    c ? { ...c, wabaId: e.target.value } : c
                  )
                }
                placeholder="e.g. 123456789012345"
                className="border-slate-700 bg-slate-900 font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label>
                Phone Number ID <span className="text-red-400">*</span>
              </Label>
              <Input
                value={editCreds?.phoneNumberId ?? ''}
                onChange={(e) =>
                  setEditCreds((c) =>
                    c ? { ...c, phoneNumberId: e.target.value } : c
                  )
                }
                placeholder="e.g. 987654321098765"
                className="border-slate-700 bg-slate-900 font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label>
                System User Access Token{' '}
                <span className="text-xs text-slate-500">
                  (optional — stored encrypted)
                </span>
              </Label>
              <Input
                type="password"
                value={editCreds?.accessToken ?? ''}
                onChange={(e) =>
                  setEditCreds((c) =>
                    c ? { ...c, accessToken: e.target.value } : c
                  )
                }
                placeholder="EAAxxxxxxxx…"
                className="border-slate-700 bg-slate-900 font-mono text-sm"
              />
              <p className="text-[11px] leading-relaxed text-slate-500">
                Get this from Meta Business Manager → Settings → System Users →
                Generate Token. Leave blank to keep the existing stored token.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                onClick={() => setEditCreds(null)}
                disabled={savingCreds}
              >
                Cancel
              </Button>
              <Button onClick={saveCredentials} disabled={savingCreds}>
                {savingCreds ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent className="max-w-md border-slate-800 bg-slate-950 text-white">
          <DialogHeader>
            <DialogTitle>New Tenant</DialogTitle>
          </DialogHeader>
          <div className="mt-2 space-y-4">
            <div className="space-y-1.5">
              <Label>Business Name</Label>
              <Input
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="Amstago Tours"
                className="border-slate-700 bg-slate-900"
              />
            </div>
            <div className="space-y-1.5">
              <Label>
                Slug{' '}
                <span className="text-xs text-slate-500">(URL identifier)</span>
              </Label>
              <Input
                value={form.slug}
                onChange={(e) =>
                  setForm((f) => ({ ...f, slug: e.target.value }))
                }
                placeholder="amstago-tours"
                className="border-slate-700 bg-slate-900 font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Plan</Label>
              <select
                value={form.plan}
                onChange={(e) =>
                  setForm((f) => ({ ...f, plan: e.target.value }))
                }
                className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
              >
                <option value="starter">Starter</option>
                <option value="growth">Growth</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setShowNew(false)}>
                Cancel
              </Button>
              <Button onClick={createTenant} disabled={saving}>
                {saving ? 'Creating…' : 'Create Tenant'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
