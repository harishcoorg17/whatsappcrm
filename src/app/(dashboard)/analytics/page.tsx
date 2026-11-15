'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  BarChart3,
  Clock,
  Loader2,
  MessageSquare,
  Timer,
  Users,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useTenant } from '@/hooks/use-tenant';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import {
  DEFAULT_SLA_MINUTES,
  PERIOD_OPTIONS,
  chartMax,
  clampSlaMinutes,
  formatDayLabel,
  formatMinutes,
  formatPercent,
  parseOverview,
  type AnalyticsOverview,
} from '@/lib/analytics';

interface ProfileName {
  user_id: string;
  full_name: string | null;
  email: string | null;
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'default',
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'good' | 'bad';
}) {
  const toneClass =
    tone === 'good'
      ? 'text-emerald-400'
      : tone === 'bad'
        ? 'text-red-400'
        : 'text-white';
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <p className={`mt-2 text-2xl font-semibold ${toneClass}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export default function AnalyticsPage() {
  const supabase = useMemo(() => createClient(), []);
  const { tenants, selectedTenantId, loading: tenantsLoading } = useTenant();

  // With one tenant there is nothing to choose; otherwise follow the switcher.
  const tenantId =
    selectedTenantId ?? (tenants.length === 1 ? tenants[0].id : null);
  const tenantName = tenants.find((t) => t.id === tenantId)?.name;

  const [days, setDays] = useState<number>(7);
  const [slaMinutes, setSlaMinutes] = useState<number>(DEFAULT_SLA_MINUTES);
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    const { data, error } = await supabase.rpc('analytics_overview', {
      p_tenant_id: tenantId,
      p_days: days,
      p_sla_minutes: slaMinutes,
    });
    if (error) {
      setLoading(false);
      toast.error(`Could not load analytics: ${error.message}`);
      return;
    }
    const parsed = parseOverview(data);
    setOverview(parsed);

    const agentIds = (parsed?.agents ?? [])
      .map((a) => a.agentId)
      .filter(Boolean);
    if (agentIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, full_name, email')
        .in('user_id', agentIds);
      setNames(
        Object.fromEntries(
          ((profiles ?? []) as ProfileName[]).map((p) => [
            p.user_id,
            p.full_name || p.email || 'Team member',
          ])
        )
      );
    }
    setLoading(false);
  }, [supabase, tenantId, days, slaMinutes]);

  useEffect(() => {
    void load();
  }, [load]);

  const max = overview ? chartMax(overview.daily) : 1;
  const slaTone =
    overview?.slaMetPercent == null
      ? 'default'
      : overview.slaMetPercent >= 90
        ? 'good'
        : overview.slaMetPercent < 70
          ? 'bad'
          : 'default';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description={
          tenantName
            ? `Response times and workload for ${tenantName}`
            : 'Response times, SLA and workload'
        }
      />

      {!tenantId ? (
        <EmptyState
          icon={BarChart3}
          title={tenantsLoading ? 'Loading…' : 'Choose a tenant'}
          description="Pick a tenant in the switcher on the left to see its analytics."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex rounded-lg border border-slate-700 bg-slate-900 p-0.5">
              {PERIOD_OPTIONS.map((option) => (
                <button
                  key={option}
                  onClick={() => setDays(option)}
                  className={`rounded-md px-3 py-1 text-sm ${
                    days === option
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {option} days
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-400">
              Reply target
              <input
                type="number"
                min={1}
                max={1440}
                value={slaMinutes}
                onChange={(e) =>
                  setSlaMinutes(clampSlaMinutes(Number(e.target.value)))
                }
                className="w-20 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-white"
              />
              min
            </label>
            {loading && (
              <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
            )}
          </div>

          {overview && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                  icon={MessageSquare}
                  label="New conversations"
                  value={String(overview.conversations)}
                  hint={`${overview.inboundMessages} received · ${overview.outboundMessages} sent`}
                />
                <StatCard
                  icon={Timer}
                  label="Avg first response"
                  value={formatMinutes(overview.avgFirstResponseMinutes)}
                  hint={`Median ${formatMinutes(overview.medianFirstResponseMinutes)}`}
                />
                <StatCard
                  icon={Clock}
                  label={`Replied within ${overview.slaMinutes} min`}
                  value={formatPercent(overview.slaMetPercent)}
                  tone={slaTone}
                  hint={`${overview.respondedConversations} replied · ${overview.unansweredConversations} not yet`}
                />
                <StatCard
                  icon={Users}
                  label="Waiting past target"
                  value={String(overview.waitingBreaches)}
                  tone={overview.waitingBreaches > 0 ? 'bad' : 'good'}
                  hint="Open chats whose last message is the customer's"
                />
              </div>

              <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-white">
                    Messages per day
                  </h2>
                  <div className="flex items-center gap-3 text-xs text-slate-400">
                    <span className="flex items-center gap-1">
                      <span className="bg-primary h-2 w-2 rounded-sm" />{' '}
                      Received
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-sm bg-slate-500" /> Sent
                    </span>
                  </div>
                </div>
                <div className="flex h-40 items-end gap-2">
                  {overview.daily.map((point) => (
                    <div
                      key={point.day}
                      className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
                      title={`${formatDayLabel(point.day)}: ${point.inbound} received, ${point.outbound} sent`}
                    >
                      <div className="flex h-full w-full items-end justify-center gap-0.5">
                        <div
                          className="bg-primary w-full max-w-4 rounded-t"
                          style={{ height: `${(point.inbound / max) * 100}%` }}
                        />
                        <div
                          className="w-full max-w-4 rounded-t bg-slate-500"
                          style={{ height: `${(point.outbound / max) * 100}%` }}
                        />
                      </div>
                      <span className="truncate text-[10px] text-slate-500">
                        {overview.daily.length <= 14
                          ? formatDayLabel(point.day)
                          : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              <div className="grid gap-6 lg:grid-cols-2">
                <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                  <h2 className="mb-3 text-sm font-semibold text-white">
                    Waiting for a reply
                  </h2>
                  {overview.waitingNow.length === 0 ? (
                    <p className="py-4 text-sm text-slate-400">
                      Nobody is waiting. Every open chat has had a reply.
                    </p>
                  ) : (
                    <ul className="divide-y divide-slate-800">
                      {overview.waitingNow.map((chat) => (
                        <li
                          key={chat.conversationId}
                          className="flex items-center justify-between py-2 text-sm"
                        >
                          <span
                            className={
                              chat.waitingMinutes > overview.slaMinutes
                                ? 'text-red-400'
                                : 'text-slate-300'
                            }
                          >
                            Waiting {formatMinutes(chat.waitingMinutes)}
                          </span>
                          <Link
                            href={`/inbox?c=${chat.conversationId}`}
                            className="text-primary text-xs hover:underline"
                          >
                            Open chat
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                  <h2 className="mb-3 text-sm font-semibold text-white">
                    Team workload
                  </h2>
                  {overview.agents.length === 0 ? (
                    <p className="py-4 text-sm text-slate-400">
                      No conversations were assigned to a team member in this
                      period.
                    </p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-slate-500">
                          <th className="pb-2 font-medium">Team member</th>
                          <th className="pb-2 text-right font-medium">
                            Assigned
                          </th>
                          <th className="pb-2 text-right font-medium">
                            Closed
                          </th>
                          <th className="pb-2 text-right font-medium">
                            First reply
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {overview.agents.map((agent) => (
                          <tr key={agent.agentId}>
                            <td className="py-2 text-slate-200">
                              {names[agent.agentId] ?? 'Team member'}
                            </td>
                            <td className="py-2 text-right text-slate-300">
                              {agent.assigned}
                            </td>
                            <td className="py-2 text-right text-slate-300">
                              {agent.closed}
                            </td>
                            <td className="py-2 text-right text-slate-300">
                              {formatMinutes(agent.avgFirstResponseMinutes)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </section>
              </div>

              <p className="text-xs text-slate-500">
                First response is the time from a customer&apos;s first message
                to the first reply from a person. Automatic replies such as the
                away message don&apos;t count. Days are UTC.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
