'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { BellOff } from 'lucide-react';

type ConsentStatus = 'unknown' | 'opted_in' | 'opted_out';

interface ConsentControlProps {
  contactId: string;
  status: ConsentStatus;
}

const LABELS: Record<ConsentStatus, string> = {
  unknown: 'Not recorded',
  opted_in: 'Opted in',
  opted_out: 'Opted out',
};

const TONES: Record<ConsentStatus, string> = {
  unknown: 'text-slate-400',
  opted_in: 'text-emerald-400',
  opted_out: 'text-red-400',
};

/**
 * Marketing consent for the open contact. Opted-out people are left out of
 * every broadcast; they can also opt out themselves by sending STOP.
 */
export function ConsentControl({ contactId, status }: ConsentControlProps) {
  const [current, setCurrent] = useState<ConsentStatus>(status);
  const [saving, setSaving] = useState(false);

  // Follow the contact when another chat is opened.
  useEffect(() => {
    setCurrent(status);
  }, [contactId, status]);

  const change = async (next: ConsentStatus) => {
    if (next === current) return;
    const previous = current;
    setCurrent(next);
    setSaving(true);
    try {
      const res = await fetch(
        `/api/contacts/${encodeURIComponent(contactId)}/consent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: next }),
        }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Could not update');
      }
      toast.success(`Marketing: ${LABELS[next].toLowerCase()}`);
    } catch (error) {
      setCurrent(previous);
      toast.error(error instanceof Error ? error.message : 'Could not update');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-b border-slate-800 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-400 uppercase">
          <BellOff className="h-3.5 w-3.5" />
          Marketing
        </span>
        <select
          aria-label="Marketing consent"
          value={current}
          disabled={saving}
          onChange={(e) => change(e.target.value as ConsentStatus)}
          className={`rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs ${TONES[current]}`}
        >
          {(Object.keys(LABELS) as ConsentStatus[]).map((s) => (
            <option key={s} value={s}>
              {LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      {current === 'opted_out' && (
        <p className="mt-2 text-xs text-slate-500">
          Left out of broadcasts. Customers can reply START to subscribe again.
        </p>
      )}
    </div>
  );
}
