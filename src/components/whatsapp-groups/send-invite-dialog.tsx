'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { MAX_INVITE_BATCH } from '@/lib/whatsapp-groups/eligibility';
import { api, inputClass, type GroupRow } from './api';

interface Props {
  slug: string;
  group: GroupRow;
  onClose: () => void;
  onDone: () => void;
}

interface ContactOption {
  id: string;
  name: string | null;
  phone: string;
}
interface TagOption {
  id: string;
  name: string;
}
interface TemplateOption {
  name: string;
  language: string | null;
  body_text: string;
}
interface Outcome {
  contactId: string;
  name: string | null;
  status: 'sent' | 'failed' | 'skipped';
  reason?: string;
}
interface SendResponse {
  outcomes: Outcome[];
  counts: { sent: number; failed: number; skipped: number };
  dropped: number;
}

export function SendInviteDialog({ slug, group, onClose, onDone }: Props) {
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [tags, setTags] = useState<TagOption[]>([]);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [tagId, setTagId] = useState('');
  const [template, setTemplate] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResponse | null>(null);

  useEffect(() => {
    const supabase = createClient();
    void (async () => {
      const [c, t, m] = await Promise.all([
        supabase.from('contacts').select('id, name, phone').order('name').limit(1000),
        supabase.from('tags').select('id, name').order('name'),
        supabase
          .from('message_templates')
          .select('name, language, body_text')
          .eq('status', 'APPROVED')
          .order('name'),
      ]);
      setContacts((c.data ?? []) as ContactOption[]);
      setTags((t.data ?? []) as TagOption[]);
      setTemplates((m.data ?? []) as TemplateOption[]);
      setLoading(false);
    })();
  }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) => (c.name ?? '').toLowerCase().includes(q) || c.phone.includes(q)
    );
  }, [contacts, search]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const nothingChosen = selected.size === 0 && !tagId;

  const send = async () => {
    setSending(true);
    const chosen = templates.find((t) => t.name === template);
    const res = await api<SendResponse>(
      `/api/tenants/${encodeURIComponent(slug)}/whatsapp-groups/${group.id}/invites`,
      {
        method: 'POST',
        body: JSON.stringify({
          contactIds: [...selected],
          tagId: tagId || null,
          templateName: chosen?.name ?? null,
          templateLanguage: chosen?.language ?? null,
        }),
      }
    );
    setSending(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setResult(res.data);
    onDone();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send invite: {group.name}</DialogTitle>
          <DialogDescription>
            Up to {MAX_INVITE_BATCH} people per send. Opted-out and already-invited
            contacts are skipped. Within 24 hours of their last message the link goes
            as a normal message; otherwise an approved template is needed.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-200">
              Sent {result.counts.sent}, skipped {result.counts.skipped}, failed{' '}
              {result.counts.failed}.
              {result.dropped > 0 && ` ${result.dropped} over the limit were not included.`}
            </p>
            <ul className="max-h-48 space-y-1 overflow-y-auto text-xs text-slate-400">
              {result.outcomes
                .filter((o) => o.status !== 'sent')
                .map((o) => (
                  <li key={o.contactId}>
                    {o.name ?? 'Contact'}: {o.reason}
                  </li>
                ))}
            </ul>
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="si-tag">Everyone with a tag (optional)</Label>
              <select
                id="si-tag"
                className={inputClass}
                value={tagId}
                onChange={(e) => setTagId(e.target.value)}
              >
                <option value="">No tag</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="si-search">Or pick contacts ({selected.size} chosen)</Label>
              <input
                id="si-search"
                className={inputClass}
                placeholder="Search name or phone"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-800">
                {loading ? (
                  <Loader2 className="mx-auto my-4 size-4 animate-spin" />
                ) : visible.length === 0 ? (
                  <p className="p-3 text-xs text-slate-500">No contacts found.</p>
                ) : (
                  visible.map((c) => (
                    <label
                      key={c.id}
                      className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800/50"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggle(c.id)}
                      />
                      <span className="truncate">{c.name ?? c.phone}</span>
                      {c.name && <span className="text-xs text-slate-500">{c.phone}</span>}
                    </label>
                  ))
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="si-template">Template for people outside the 24-hour window</Label>
              <select
                id="si-template"
                className={inputClass}
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
              >
                <option value="">None: skip those contacts</option>
                {templates.map((t) => (
                  <option key={`${t.name}-${t.language}`} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500">
                {templates.length === 0
                  ? 'No approved templates yet. Create one under Broadcasts → Templates.'
                  : 'Variables: {{1}} first name, {{2}} group name, {{3}} invite link.'}
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={send} disabled={sending || nothingChosen}>
                {sending && <Loader2 className="mr-2 size-4 animate-spin" />}
                Send invite
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
