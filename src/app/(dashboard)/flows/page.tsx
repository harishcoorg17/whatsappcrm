'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Workflow,
  Plus,
  Trash2,
  Pencil,
  Loader2,
  MessageSquare,
  PlayCircle,
  PauseCircle,
  Archive,
  HelpCircle,
  UserPlus,
  FileText,
  Plane,
  Stethoscope,
  ShoppingBag,
  Home,
  GraduationCap,
  Utensils,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Flows list page.
 *
 * Open to every authenticated user. Flows is in soft-GA — the "Beta"
 * chip in the header is the only remaining signal that the surface
 * is new. The previous per-account beta gate was removed in PR #134.
 */

interface FlowRow {
  id: string;
  name: string;
  description: string | null;
  status: 'draft' | 'active' | 'archived';
  trigger_type:
    | 'keyword'
    | 'first_inbound_message'
    | 'returning_customer'
    | 'manual';
  trigger_config: { keywords?: string[] } | Record<string, unknown>;
  execution_count: number;
  last_executed_at: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_LABELS: Record<FlowRow['status'], string> = {
  draft: 'Draft',
  active: 'Active',
  archived: 'Archived',
};

const STATUS_COLORS: Record<FlowRow['status'], string> = {
  draft: 'border-slate-700 bg-slate-800 text-slate-300',
  active: 'border-emerald-600/40 bg-emerald-500/10 text-emerald-300',
  archived: 'border-slate-700 bg-slate-800/50 text-slate-500',
};

interface TemplateSummary {
  slug: string;
  name: string;
  description: string;
  icon: keyof typeof TEMPLATE_ICONS;
  industry: string;
  trigger_type: string;
  node_count: number;
}

const TEMPLATE_ICONS = {
  MessageSquare,
  HelpCircle,
  UserPlus,
  Plane,
  Stethoscope,
  ShoppingBag,
  Home,
  GraduationCap,
  Utensils,
} as const;

const INDUSTRY_LABELS: Record<string, string> = {
  general: 'General',
  travel: 'Travel',
  healthcare: 'Clinic',
  retail: 'Retail',
  real_estate: 'Real estate',
  education: 'Education',
  restaurant: 'Restaurant',
};

export default function FlowsPage() {
  const router = useRouter();
  const [flows, setFlows] = useState<FlowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [industryFilter, setIndustryFilter] = useState<string>('all');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [flowsRes, tmplRes] = await Promise.all([
          fetch('/api/flows'),
          fetch('/api/flows/templates'),
        ]);
        if (!flowsRes.ok) {
          throw new Error(`Failed to load flows: ${flowsRes.status}`);
        }
        const flowsJson = (await flowsRes.json()) as { flows: FlowRow[] };
        if (!cancelled) setFlows(flowsJson.flows ?? []);
        // Templates endpoint is forward-looking — if it 404s on an
        // older deployment, gracefully fall through.
        if (tmplRes.ok) {
          const tmplJson = (await tmplRes.json()) as {
            templates: TemplateSummary[];
          };
          if (!cancelled) setTemplates(tmplJson.templates ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          toast.error("Couldn't load flows.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          trigger_type: 'keyword',
          trigger_config: { keywords: [] },
        }),
      });
      if (!res.ok) throw new Error(`Create failed: ${res.status}`);
      const json = (await res.json()) as { flow: FlowRow };
      setCreateOpen(false);
      setNewName('');
      router.push(`/flows/${json.flow.id}`);
    } catch (err) {
      console.error(err);
      toast.error("Couldn't create flow.");
    } finally {
      setCreating(false);
    }
  }

  async function handleUseTemplate(slug: string) {
    setCreating(true);
    try {
      const res = await fetch('/api/flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_slug: slug }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Clone failed: ${res.status}`);
      }
      const json = (await res.json()) as { flow: FlowRow };
      setCreateOpen(false);
      router.push(`/flows/${json.flow.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Clone failed';
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(flow: FlowRow) {
    const yes = window.confirm(
      `Delete "${flow.name}"? Any active runs will end immediately.`
    );
    if (!yes) return;
    try {
      const res = await fetch(`/api/flows/${flow.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      setFlows((prev) => prev.filter((f) => f.id !== flow.id));
      toast.success('Flow deleted.');
    } catch (err) {
      console.error(err);
      toast.error("Couldn't delete flow.");
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Flows"
        description="Build branching, button-driven WhatsApp conversations. Useful for menus, FAQs, and triage before a human steps in."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            New flow
          </Button>
        }
      />

      {flows.length === 0 ? (
        <EmptyState
          icon={Workflow}
          title="No flows yet"
          description="Build your first conversation — a welcome menu, an order lookup, an FAQ bot. Customers tap buttons; the bot routes them to the right answer (or the right agent)."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              Create your first flow
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {flows.map((flow) => (
            <FlowCard
              key={flow.id}
              flow={flow}
              onEdit={() => router.push(`/flows/${flow.id}`)}
              onDelete={() => handleDelete(flow)}
            />
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        {/* `sm:max-w-4xl` not `max-w-4xl` — shadcn's DialogContent has
            `sm:max-w-sm` baked into its default classes. Without the
            sm: prefix our override applies at base only and the
            sm-scoped 384px wins at every real desktop breakpoint. */}
        <DialogContent className="bg-slate-900 text-slate-100 sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Create a new flow</DialogTitle>
            <DialogDescription className="text-slate-400">
              Start from a template or build from scratch.
            </DialogDescription>
          </DialogHeader>

          {templates.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs tracking-wide text-slate-500 uppercase">
                Start from a template
              </p>
              <div
                className="flex flex-wrap gap-2"
                role="group"
                aria-label="Filter templates by industry"
              >
                {[
                  'all',
                  ...Array.from(new Set(templates.map((t) => t.industry))),
                ].map((key) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={industryFilter === key}
                    onClick={() => setIndustryFilter(key)}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                      industryFilter === key
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-slate-700 text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    {key === 'all' ? 'All' : (INDUSTRY_LABELS[key] ?? key)}
                  </button>
                ))}
              </div>
              <div className="grid max-h-[50vh] grid-cols-1 gap-3 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
                {templates
                  .filter(
                    (t) =>
                      industryFilter === 'all' || t.industry === industryFilter
                  )
                  .map((t) => {
                    const Icon = TEMPLATE_ICONS[t.icon] ?? FileText;
                    return (
                      <button
                        key={t.slug}
                        type="button"
                        onClick={() => handleUseTemplate(t.slug)}
                        disabled={creating}
                        className="hover:border-primary/40 flex flex-col gap-2.5 rounded-lg border border-slate-800 bg-slate-950 p-4 text-left transition-colors hover:bg-slate-800 disabled:opacity-50"
                      >
                        <Icon className="text-primary h-5 w-5" />
                        <span className="text-sm font-semibold text-white">
                          {t.name}
                        </span>
                        <span className="text-xs leading-relaxed text-slate-400">
                          {t.description}
                        </span>
                        <span className="mt-auto flex justify-between border-t border-slate-800 pt-2 text-[11px] text-slate-500">
                          <span>
                            {INDUSTRY_LABELS[t.industry] ?? t.industry}
                          </span>
                          <span>
                            {t.node_count}{' '}
                            {t.node_count === 1 ? 'node' : 'nodes'}
                          </span>
                        </span>
                      </button>
                    );
                  })}
              </div>
            </div>
          )}

          <div className="space-y-2 border-t border-slate-800 pt-4">
            <p className="text-xs tracking-wide text-slate-500 uppercase">
              Or start blank
            </p>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Welcome menu"
              className="bg-slate-800"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
              }}
            />
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!newName.trim() || creating}
            >
              {creating && <Loader2 className="h-4 w-4 animate-spin" />}
              Create blank flow
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FlowCard({
  flow,
  onEdit,
  onDelete,
}: {
  flow: FlowRow;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const triggerSummary = describeTrigger(flow);
  const StatusIcon =
    flow.status === 'active'
      ? PlayCircle
      : flow.status === 'archived'
        ? Archive
        : PauseCircle;
  return (
    <div className="glass-card flex flex-col p-4 transition-all hover:border-slate-700">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Workflow className="text-primary h-4 w-4 shrink-0" />
          <h3 className="truncate text-sm font-semibold text-white">
            {flow.name}
          </h3>
        </div>
        <Badge
          variant="outline"
          className={cn(
            'shrink-0 gap-1 text-[10px]',
            STATUS_COLORS[flow.status]
          )}
        >
          <StatusIcon className="h-3 w-3" />
          {STATUS_LABELS[flow.status]}
        </Badge>
      </div>

      <p className="mt-2 line-clamp-2 text-xs text-slate-400">
        {flow.description || triggerSummary}
      </p>

      <div className="mt-4 flex items-center gap-3 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="h-3 w-3" />
          {flow.execution_count} {flow.execution_count === 1 ? 'run' : 'runs'}
        </span>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-800 pt-3">
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>
      </div>
    </div>
  );
}

function describeTrigger(flow: FlowRow): string {
  if (flow.trigger_type === 'keyword') {
    const keywords = Array.isArray(flow.trigger_config.keywords)
      ? (flow.trigger_config.keywords as string[])
      : [];
    if (keywords.length === 0) return 'Triggers on keyword (none set)';
    return `Triggers on: ${keywords.join(', ')}`;
  }
  if (flow.trigger_type === 'first_inbound_message') {
    return "Triggers on a contact's first-ever inbound message";
  }
  if (flow.trigger_type === 'returning_customer') {
    return 'Triggers when a returning customer messages again';
  }
  return 'Manual trigger';
}
