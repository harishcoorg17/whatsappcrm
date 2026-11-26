export type GroupKind = 'group' | 'channel';

export interface GroupRow {
  id: string;
  kind: GroupKind;
  name: string;
  invite_url: string | null;
  description: string | null;
  capacity: number | null;
  departure_date: string | null;
  is_active: boolean;
  invite_count: number;
  joined_count: number;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function api<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
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

export const inputClass =
  'h-9 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-primary focus:outline-none';
