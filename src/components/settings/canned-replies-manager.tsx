'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useTenant } from '@/hooks/use-tenant';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  MAX_BODY_LENGTH,
  normalizeShortcut,
  validateReplyDraft,
  type CannedReply,
  type ReplyDraftErrors,
} from '@/lib/canned-replies';

const ALL_TENANTS = 'all';
const UNIQUE_VIOLATION = '23505';

interface Draft {
  id: string | null;
  shortcut: string;
  title: string;
  body: string;
  scope: string;
}

const EMPTY_DRAFT: Draft = {
  id: null,
  shortcut: '',
  title: '',
  body: '',
  scope: ALL_TENANTS,
};

/**
 * Create and manage quick replies. Agents type "/shortcut" in the inbox
 * composer to insert one; {{name}} and {{phone}} are filled from the contact.
 */
export function CannedRepliesManager() {
  const supabase = createClient();
  const { user, loading: authLoading } = useAuth();
  const { tenants } = useTenant();

  const [replies, setReplies] = useState<CannedReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<ReplyDraftErrors>({});

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('canned_replies')
      .select('id, shortcut, title, body, tenant_id')
      .order('shortcut', { ascending: true });
    setLoading(false);
    if (error) {
      toast.error(`Could not load quick replies: ${error.message}`);
      return;
    }
    setReplies((data ?? []) as CannedReply[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!authLoading && user) void load();
  }, [authLoading, user, load]);

  const tenantName = (tenantId: string | null) =>
    tenantId === null
      ? 'All tenants'
      : (tenants.find((t) => t.id === tenantId)?.name ?? 'One tenant');

  const startEdit = (reply: CannedReply) => {
    setErrors({});
    setDraft({
      id: reply.id,
      shortcut: reply.shortcut,
      title: reply.title ?? '',
      body: reply.body,
      scope: reply.tenant_id ?? ALL_TENANTS,
    });
  };

  const save = async () => {
    if (!user) return;
    const found = validateReplyDraft(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    const row = {
      shortcut: normalizeShortcut(draft.shortcut),
      title: draft.title.trim() || null,
      body: draft.body.trim(),
      tenant_id: draft.scope === ALL_TENANTS ? null : draft.scope,
    };
    const { error } = draft.id
      ? await supabase.from('canned_replies').update(row).eq('id', draft.id)
      : await supabase
          .from('canned_replies')
          .insert({ ...row, user_id: user.id });
    setSaving(false);

    if (error) {
      toast.error(
        error.code === UNIQUE_VIOLATION
          ? 'You already have a reply with that shortcut for this scope'
          : error.message
      );
      return;
    }
    toast.success(draft.id ? 'Quick reply updated' : 'Quick reply added');
    setDraft(EMPTY_DRAFT);
    setErrors({});
    void load();
  };

  const remove = async (reply: CannedReply) => {
    if (!window.confirm(`Delete /${reply.shortcut}?`)) return;
    const { error } = await supabase
      .from('canned_replies')
      .delete()
      .eq('id', reply.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Quick reply deleted');
    if (draft.id === reply.id) setDraft(EMPTY_DRAFT);
    void load();
  };

  return (
    <div className="space-y-6">
      <Card className="border-slate-800 bg-slate-900">
        <CardContent className="space-y-4 p-5">
          <div>
            <h3 className="text-base font-semibold text-white">
              {draft.id ? 'Edit quick reply' : 'New quick reply'}
            </h3>
            <p className="mt-1 text-xs text-slate-400">
              In the inbox, type <span className="font-mono">/</span> and the
              shortcut to insert it. Use{' '}
              <span className="font-mono">{'{{name}}'}</span> and{' '}
              <span className="font-mono">{'{{phone}}'}</span> to fill in the
              contact.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Shortcut</Label>
              <div className="relative">
                <span className="absolute top-1/2 left-3 -translate-y-1/2 font-mono text-sm text-slate-500">
                  /
                </span>
                <Input
                  value={draft.shortcut}
                  onChange={(e) =>
                    setDraft({ ...draft, shortcut: e.target.value })
                  }
                  placeholder="hours"
                  className="border-slate-700 bg-slate-800 pl-6 font-mono text-sm"
                />
              </div>
              {errors.shortcut && (
                <p className="text-xs text-red-400">{errors.shortcut}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Title (optional)</Label>
              <Input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="Opening hours"
                className="border-slate-700 bg-slate-800 text-sm"
              />
              {errors.title && (
                <p className="text-xs text-red-400">{errors.title}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Available in</Label>
              <select
                value={draft.scope}
                onChange={(e) => setDraft({ ...draft, scope: e.target.value })}
                className="h-9 w-full rounded-md border border-slate-700 bg-slate-800 px-2 text-sm text-slate-200"
              >
                <option value={ALL_TENANTS}>All tenants</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Message</Label>
            <textarea
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              rows={4}
              maxLength={MAX_BODY_LENGTH}
              placeholder="Hi {{name}}, we are open 9am to 6pm, Monday to Saturday."
              className="focus:border-primary/50 w-full resize-y rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none"
            />
            <div className="flex justify-between text-xs">
              <span className="text-red-400">{errors.body}</span>
              <span className="text-slate-500">
                {draft.body.length}/{MAX_BODY_LENGTH}
              </span>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            {draft.id && (
              <Button
                variant="outline"
                onClick={() => {
                  setDraft(EMPTY_DRAFT);
                  setErrors({});
                }}
              >
                Cancel
              </Button>
            )}
            <Button onClick={save} disabled={saving} className="gap-2">
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {draft.id ? 'Save changes' : 'Add quick reply'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : replies.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">
            No quick replies yet. Add the answers you give most often.
          </p>
        ) : (
          replies.map((reply) => (
            <div
              key={reply.id}
              className="flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-900 p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-primary font-mono text-sm">
                    /{reply.shortcut}
                  </span>
                  {reply.title && (
                    <span className="text-sm font-medium text-slate-200">
                      {reply.title}
                    </span>
                  )}
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">
                    {tenantName(reply.tenant_id)}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs whitespace-pre-line text-slate-400">
                  {reply.body}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  onClick={() => startEdit(reply)}
                  aria-label={`Edit /${reply.shortcut}`}
                  className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={() => remove(reply)}
                  aria-label={`Delete /${reply.shortcut}`}
                  className="rounded-md p-1.5 text-red-400 hover:bg-red-950/40"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
