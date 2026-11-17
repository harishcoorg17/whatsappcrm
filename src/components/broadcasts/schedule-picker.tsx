'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import {
  MIN_LEAD_MS,
  validateScheduledAt,
} from '@/lib/broadcasts/scheduler/schedule-time';

/** `datetime-local` wants "YYYY-MM-DDTHH:mm" in the user's local zone. */
export function toLocalInputValue(date: Date): string {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

/** Converts a datetime-local value to a validated UTC ISO string. */
export function localInputToIso(
  value: string,
  now: Date = new Date()
): { ok: true; iso: string } | { ok: false; error: string } {
  // The browser parses "YYYY-MM-DDTHH:mm" as local time.
  const checked = validateScheduledAt(value ? new Date(value).toISOString() : '', now);
  return checked.ok
    ? { ok: true, iso: checked.scheduledAt }
    : { ok: false, error: checked.error };
}

interface SchedulePickerProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function SchedulePicker({ value, onChange, disabled }: SchedulePickerProps) {
  // Computed once on mount; the server re-validates the lead time anyway.
  const [min] = useState(() =>
    toLocalInputValue(new Date(Date.now() + MIN_LEAD_MS)),
  );
  return (
    <Input
      type="datetime-local"
      value={value}
      min={min}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Send date and time"
      className="w-full border-slate-700 bg-slate-800 text-white sm:w-64"
    />
  );
}
