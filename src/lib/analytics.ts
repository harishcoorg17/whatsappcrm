/**
 * Types, parsing and formatting for the Analytics page. The numbers come from
 * the `analytics_overview` database function (migration 033); this file turns
 * its JSON into a typed, defensive shape so the page never renders NaN.
 */

export interface DailyPoint {
  /** UTC calendar day, YYYY-MM-DD. */
  day: string;
  inbound: number;
  outbound: number;
}

export interface WaitingChat {
  conversationId: string;
  waitingMinutes: number;
}

export interface AgentStat {
  agentId: string;
  assigned: number;
  closed: number;
  avgFirstResponseMinutes: number | null;
}

export interface AnalyticsOverview {
  days: number;
  slaMinutes: number;
  conversations: number;
  inboundMessages: number;
  outboundMessages: number;
  respondedConversations: number;
  unansweredConversations: number;
  avgFirstResponseMinutes: number | null;
  medianFirstResponseMinutes: number | null;
  /** Share of first responses within the SLA, 0-100; null with no responses. */
  slaMetPercent: number | null;
  waitingBreaches: number;
  waitingNow: WaitingChat[];
  daily: DailyPoint[];
  agents: AgentStat[];
}

export const PERIOD_OPTIONS = [7, 14, 30] as const;
export const DEFAULT_SLA_MINUTES = 15;

const num = (value: unknown, fallback = 0): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const nullableNum = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const list = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value)
    ? value.filter(
        (v): v is Record<string, unknown> => typeof v === 'object' && v !== null
      )
    : [];

/** Turn the database JSON into a typed overview; returns null for non-objects. */
export function parseOverview(raw: unknown): AnalyticsOverview | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  return {
    days: num(r.days, 7),
    slaMinutes: num(r.slaMinutes, DEFAULT_SLA_MINUTES),
    conversations: num(r.conversations),
    inboundMessages: num(r.inboundMessages),
    outboundMessages: num(r.outboundMessages),
    respondedConversations: num(r.respondedConversations),
    unansweredConversations: num(r.unansweredConversations),
    avgFirstResponseMinutes: nullableNum(r.avgFirstResponseMinutes),
    medianFirstResponseMinutes: nullableNum(r.medianFirstResponseMinutes),
    slaMetPercent: nullableNum(r.slaMetPercent),
    waitingBreaches: num(r.waitingBreaches),
    waitingNow: list(r.waitingNow).map((w) => ({
      conversationId: String(w.conversationId ?? ''),
      waitingMinutes: num(w.waitingMinutes),
    })),
    daily: list(r.daily).map((d) => ({
      day: String(d.day ?? ''),
      inbound: num(d.inbound),
      outbound: num(d.outbound),
    })),
    agents: list(r.agents).map((a) => ({
      agentId: String(a.agentId ?? ''),
      assigned: num(a.assigned),
      closed: num(a.closed),
      avgFirstResponseMinutes: nullableNum(a.avgFirstResponseMinutes),
    })),
  };
}

/** "45s", "12 min", "2h 5m", "3d 4h"; "–" when there is no data. */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes))
    return '–';
  if (minutes < 1) return `${Math.max(1, Math.round(minutes * 60))}s`;
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  if (hours < 24) return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
  const days = Math.floor(hours / 24);
  const hoursLeft = hours % 24;
  return hoursLeft === 0 ? `${days}d` : `${days}d ${hoursLeft}h`;
}

export function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? '–'
    : `${Math.round(value)}%`;
}

/** "Mon 16" style label for a UTC calendar day. */
export function formatDayLabel(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** Largest bar value in the series (at least 1, so heights never divide by 0). */
export function chartMax(points: readonly DailyPoint[]): number {
  return Math.max(1, ...points.map((p) => Math.max(p.inbound, p.outbound)));
}

/** Clamp the SLA input to what the database accepts (1 minute to 24 hours). */
export function clampSlaMinutes(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SLA_MINUTES;
  return Math.min(1440, Math.max(1, Math.round(value)));
}
