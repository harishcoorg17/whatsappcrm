'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  DEFAULT_CSAT_MESSAGE,
  MAX_CSAT_MESSAGE_LENGTH,
} from '@/lib/csat/csat';

interface EngagementDialogProps {
  tenant: { slug: string; name: string } | null;
  onClose: () => void;
}

interface Settings {
  csatEnabled: boolean;
  csatMessage: string;
  alertEmail: boolean;
  alertWhatsapp: boolean;
  alertNumber: string;
}

const DEFAULTS: Settings = {
  csatEnabled: false,
  csatMessage: '',
  alertEmail: false,
  alertWhatsapp: false,
  alertNumber: '',
};

const INPUT_CLASS =
  'focus:border-primary/50 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none';

/** CSAT survey and handoff alerts for one tenant. Everything is off until switched on. */
export function EngagementDialog({ tenant, onClose }: EngagementDialogProps) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const slug = tenant?.slug ?? null;
  const url = slug ? `/api/tenants/${encodeURIComponent(slug)}/engagement` : null;
  const patch = (next: Partial<Settings>) =>
    setSettings((s) => ({ ...s, ...next }));

  const load = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    try {
      const res = await fetch(url);
      const body = (await res.json().catch(() => ({}))) as Partial<Settings> & {
        error?: string;
      };
      if (!res.ok) {
        toast.error(body.error ?? 'Could not load settings');
        return;
      }
      setSettings({ ...DEFAULTS, ...body });
    } catch {
      toast.error('Network error');
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    if (!slug) return;
    setSettings(DEFAULTS);
    void load();
  }, [slug, load]);

  const save = async () => {
    if (!url) return;
    setSaving(true);
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(body.error ?? 'Could not save');
        return;
      }
      toast.success('Feedback and alerts saved');
      onClose();
    } catch {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={tenant !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto border-slate-800 bg-slate-950 text-white">
        <DialogHeader>
          <DialogTitle>Feedback &amp; alerts — {tenant?.name}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
        ) : (
          <div className="space-y-6">
            <section className="space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={settings.csatEnabled}
                  onChange={(e) => patch({ csatEnabled: e.target.checked })}
                  className="accent-primary h-4 w-4"
                />
                Ask for a rating when a chat is closed
              </label>
              <p className="text-xs text-slate-400">
                After an agent closes a chat, the customer gets a 1–5 rating
                list. Ratings show on Analytics. A chat is surveyed at most once
                a day.
              </p>
              <div
                className={
                  settings.csatEnabled ? 'space-y-1.5' : 'space-y-1.5 opacity-50'
                }
              >
                <Label>Survey message</Label>
                <textarea
                  value={settings.csatMessage}
                  onChange={(e) => patch({ csatMessage: e.target.value })}
                  rows={3}
                  maxLength={MAX_CSAT_MESSAGE_LENGTH}
                  placeholder={DEFAULT_CSAT_MESSAGE}
                  className={`${INPUT_CLASS} resize-y`}
                />
              </div>
            </section>

            <section className="space-y-3 border-t border-slate-800 pt-4">
              <h3 className="text-sm font-medium">When a chat needs a person</h3>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings.alertEmail}
                  onChange={(e) => patch({ alertEmail: e.target.checked })}
                  className="accent-primary h-4 w-4"
                />
                Email the assigned agent (or the admins if nobody is assigned)
              </label>
              <p className="text-xs text-slate-400">
                Sent with the email gateway set up for this account.
              </p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings.alertWhatsapp}
                  onChange={(e) => patch({ alertWhatsapp: e.target.checked })}
                  className="accent-primary h-4 w-4"
                />
                Send a WhatsApp message to an admin number
              </label>
              <div
                className={
                  settings.alertWhatsapp ? 'space-y-1.5' : 'space-y-1.5 opacity-50'
                }
              >
                <Label>Admin WhatsApp number</Label>
                <input
                  type="tel"
                  value={settings.alertNumber}
                  onChange={(e) => patch({ alertNumber: e.target.value })}
                  placeholder="+91 98765 43210"
                  maxLength={32}
                  className={INPUT_CLASS}
                />
                <p className="text-xs text-slate-400">
                  WhatsApp only delivers this if that number messaged your
                  business in the last 24 hours.
                </p>
              </div>
              <p className="text-xs text-slate-500">
                Each chat alerts once per handoff, never more than once every 10
                minutes.
              </p>
            </section>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
