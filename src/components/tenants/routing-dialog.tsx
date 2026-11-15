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
  defaultBusinessHours,
  MAX_AWAY_MESSAGE_LENGTH,
  WEEKDAYS,
  type BusinessHours,
  type Weekday,
} from '@/lib/whatsapp/business-hours';

interface RoutingDialogProps {
  tenant: { slug: string; name: string } | null;
  onClose: () => void;
}

interface RoutingSettings {
  businessHours: BusinessHours;
  awayMessage: string;
  autoAssign: boolean;
}

const DAY_LABELS: Record<Weekday, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

const TIMEZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Dhaka',
  'Asia/Colombo',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Australia/Sydney',
  'UTC',
];

const DEFAULT_SETTINGS: RoutingSettings = {
  businessHours: defaultBusinessHours(),
  awayMessage: '',
  autoAssign: false,
};

/**
 * Business hours, the away message and auto-assignment for one tenant.
 * Nothing changes for customers until "Use business hours" or "Auto-assign" is
 * switched on and saved.
 */
export function RoutingDialog({ tenant, onClose }: RoutingDialogProps) {
  const [settings, setSettings] = useState<RoutingSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const slug = tenant?.slug ?? null;
  const url = slug ? `/api/tenants/${encodeURIComponent(slug)}/routing` : null;

  const load = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    try {
      const res = await fetch(url);
      const body = (await res
        .json()
        .catch(() => ({}))) as Partial<RoutingSettings> & {
        error?: string;
      };
      if (!res.ok) {
        toast.error(body.error ?? 'Could not load settings');
        return;
      }
      setSettings({
        businessHours: body.businessHours ?? defaultBusinessHours(),
        awayMessage: body.awayMessage ?? '',
        autoAssign: body.autoAssign === true,
      });
    } catch {
      toast.error('Network error');
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    if (!slug) return;
    setSettings(DEFAULT_SETTINGS);
    void load();
  }, [slug, load]);

  const hours = settings.businessHours;
  const setHours = (next: BusinessHours) =>
    setSettings((s) => ({ ...s, businessHours: next }));
  const setDay = (
    day: Weekday,
    value: { open: string; close: string } | null
  ) => setHours({ ...hours, days: { ...hours.days, [day]: value } });

  const save = async () => {
    if (!url) return;
    setSaving(true);
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessHours: hours,
          awayMessage: settings.awayMessage,
          autoAssign: settings.autoAssign,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(body.error ?? 'Could not save');
        return;
      }
      toast.success('Hours and routing saved');
      onClose();
    } catch {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  };

  const timezones = TIMEZONES.includes(hours.timezone)
    ? TIMEZONES
    : [hours.timezone, ...TIMEZONES];

  return (
    <Dialog
      open={tenant !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto border-slate-800 bg-slate-950 text-white">
        <DialogHeader>
          <DialogTitle>Hours &amp; routing — {tenant?.name}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
        ) : (
          <div className="space-y-6">
            <section className="space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={hours.enabled}
                  onChange={(e) =>
                    setHours({ ...hours, enabled: e.target.checked })
                  }
                  className="accent-primary h-4 w-4"
                />
                Use business hours
              </label>
              <p className="text-xs text-slate-400">
                Outside these hours, customers who message get your away message
                once every 12 hours. During a bot flow it stays quiet.
              </p>

              <div
                className={hours.enabled ? 'space-y-3' : 'space-y-3 opacity-50'}
              >
                <div className="space-y-1.5">
                  <Label>Timezone</Label>
                  <select
                    value={hours.timezone}
                    onChange={(e) =>
                      setHours({ ...hours, timezone: e.target.value })
                    }
                    className="h-9 w-full rounded-md border border-slate-700 bg-slate-900 px-2 text-sm text-slate-200"
                  >
                    {timezones.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  {WEEKDAYS.map((day) => {
                    const value = hours.days[day];
                    return (
                      <div
                        key={day}
                        className="flex items-center gap-3 text-sm"
                      >
                        <label className="flex w-32 items-center gap-2">
                          <input
                            type="checkbox"
                            checked={value !== null}
                            onChange={(e) =>
                              setDay(
                                day,
                                e.target.checked
                                  ? { open: '09:00', close: '18:00' }
                                  : null
                              )
                            }
                            className="accent-primary h-4 w-4"
                          />
                          {DAY_LABELS[day]}
                        </label>
                        {value ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="time"
                              aria-label={`${DAY_LABELS[day]} opens`}
                              value={value.open}
                              onChange={(e) =>
                                setDay(day, { ...value, open: e.target.value })
                              }
                              className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
                            />
                            <span className="text-slate-500">to</span>
                            <input
                              type="time"
                              aria-label={`${DAY_LABELS[day]} closes`}
                              value={value.close}
                              onChange={(e) =>
                                setDay(day, { ...value, close: e.target.value })
                              }
                              className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
                            />
                          </div>
                        ) : (
                          <span className="text-xs text-slate-500">Closed</span>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="space-y-1.5">
                  <Label>Away message</Label>
                  <textarea
                    value={settings.awayMessage}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        awayMessage: e.target.value,
                      }))
                    }
                    rows={3}
                    maxLength={MAX_AWAY_MESSAGE_LENGTH}
                    placeholder="Thanks for your message. We are closed right now and will reply when we open at 9am."
                    className="focus:border-primary/50 w-full resize-y rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none"
                  />
                </div>
              </div>
            </section>

            <section className="space-y-2 border-t border-slate-800 pt-4">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={settings.autoAssign}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, autoAssign: e.target.checked }))
                  }
                  className="accent-primary h-4 w-4"
                />
                Auto-assign new chats
              </label>
              <p className="text-xs text-slate-400">
                A chat that nobody has picked up goes to the team member with
                the fewest open chats. Needs at least one team member.
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
