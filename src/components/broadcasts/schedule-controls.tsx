'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { CalendarClock, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  SchedulePicker,
  localInputToIso,
  toLocalInputValue,
} from '@/components/broadcasts/schedule-picker';

interface ScheduleControlsProps {
  broadcastId: string;
  scheduledAt: string;
  /** Called with the server's view of the broadcast after a change. */
  onChanged: (patch: { status: string; scheduled_at: string | null }) => void;
}

/**
 * Shown on a broadcast that is still `scheduled`: lets the owner cancel it
 * (back to draft) or move it. The server only accepts either while the cron
 * has not yet claimed the broadcast.
 */
export function ScheduleControls({
  broadcastId,
  scheduledAt,
  onChanged,
}: ScheduleControlsProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(toLocalInputValue(new Date(scheduledAt)));
  const [busy, setBusy] = useState(false);

  async function call(body: Record<string, unknown>, successMessage: string) {
    setBusy(true);
    try {
      const res = await fetch('/api/whatsapp/broadcast/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broadcast_id: broadcastId, ...body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Request failed');
      onChanged(data.broadcast);
      setEditing(false);
      toast.success(successMessage);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  function handleReschedule() {
    const checked = localInputToIso(value);
    if (!checked.ok) {
      toast.error(checked.error);
      return;
    }
    void call(
      { action: 'reschedule', scheduled_at: checked.iso },
      'Broadcast rescheduled'
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
      <CalendarClock className="h-5 w-5 text-blue-400" />
      <div className="mr-auto">
        <p className="text-sm font-medium text-white">
          Scheduled for {new Date(scheduledAt).toLocaleString()}
        </p>
        <p className="text-xs text-slate-400">
          Sends automatically at this time. You can change or cancel it until it
          starts sending.
        </p>
      </div>
      {editing ? (
        <>
          <SchedulePicker value={value} onChange={setValue} disabled={busy} />
          <Button size="sm" onClick={handleReschedule} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEditing(false)}
            disabled={busy}
            className="border-slate-700 text-slate-300"
          >
            Back
          </Button>
        </>
      ) : (
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEditing(true)}
            disabled={busy}
            className="border-slate-700 text-slate-300"
          >
            Reschedule
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => call({ action: 'cancel' }, 'Schedule cancelled — saved as draft')}
            disabled={busy}
            className="border-red-500/30 text-red-400 hover:bg-red-500/10"
          >
            Cancel schedule
          </Button>
        </>
      )}
    </div>
  );
}
