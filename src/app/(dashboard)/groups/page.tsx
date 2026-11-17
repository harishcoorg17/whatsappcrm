'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Copy, Loader2, Megaphone, Pencil, Plus, Send, Trash2, Users } from 'lucide-react';
import { useTenant } from '@/hooks/use-tenant';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api, type GroupRow } from '@/components/whatsapp-groups/api';
import { GroupFormDialog } from '@/components/whatsapp-groups/group-form-dialog';
import { MembersDialog } from '@/components/whatsapp-groups/members-dialog';
import { SendInviteDialog } from '@/components/whatsapp-groups/send-invite-dialog';

type Dialogs =
  | { type: 'form'; group: GroupRow | null; key: number }
  | { type: 'send'; group: GroupRow }
  | { type: 'members'; group: GroupRow }
  | null;

export default function GroupsPage() {
  const { selectedTenant, loading: tenantLoading } = useTenant();
  const slug = selectedTenant?.slug ?? null;
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<Dialogs>(null);

  const load = useCallback(async () => {
    if (!slug) return;
    const res = await api<{ groups: GroupRow[] }>(
      `/api/tenants/${encodeURIComponent(slug)}/whatsapp-groups`
    );
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setGroups(res.data.groups);
  }, [slug]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy. Select the link and copy it manually.');
    }
  };

  const remove = async (group: GroupRow) => {
    if (!slug) return;
    if (!window.confirm(`Delete "${group.name}"? Its invite history is deleted too.`)) {
      return;
    }
    const res = await api(
      `/api/tenants/${encodeURIComponent(slug)}/whatsapp-groups/${group.id}`,
      { method: 'DELETE' }
    );
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success('Deleted');
    void load();
  };

  const close = () => setDialog(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Groups & channels"
        description="Keep the invite link for each trip's WhatsApp group and your channel, and send it to travellers."
        icon={Users}
        actions={
          <Button
            disabled={!slug}
            onClick={() => setDialog({ type: 'form', group: null, key: Date.now() })}
          >
            <Plus className="mr-2 size-4" />
            Add
          </Button>
        }
      />

      {tenantLoading || loading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : !slug ? (
        <EmptyState title="No workspace selected" icon={Users} />
      ) : groups.length === 0 ? (
        <EmptyState
          title="No groups or channels yet"
          description="Create a group in WhatsApp for a departure, then add its invite link here."
          icon={Users}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Departure</TableHead>
              <TableHead>Invited</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((g) => (
              <TableRow key={g.id}>
                <TableCell>
                  <p className="font-medium text-slate-100">{g.name}</p>
                  {!g.is_active && <span className="text-xs text-slate-500">Inactive</span>}
                </TableCell>
                <TableCell>
                  <Badge variant={g.kind === 'channel' ? 'secondary' : 'default'}>
                    {g.kind === 'channel' ? (
                      <Megaphone className="mr-1 size-3" />
                    ) : (
                      <Users className="mr-1 size-3" />
                    )}
                    {g.kind}
                  </Badge>
                </TableCell>
                <TableCell className="text-slate-300">{g.departure_date ?? '-'}</TableCell>
                <TableCell>
                  <button
                    type="button"
                    className="text-sm text-primary hover:underline"
                    onClick={() => setDialog({ type: 'members', group: g })}
                  >
                    {g.invite_count}
                    {g.capacity ? ` / ${g.capacity}` : ''} invited · {g.joined_count} joined
                  </button>
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Copy link"
                      onClick={() => void copy(g.invite_url)}
                    >
                      <Copy className="size-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Send invite"
                      disabled={!g.is_active}
                      onClick={() => setDialog({ type: 'send', group: g })}
                    >
                      <Send className="size-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Edit"
                      onClick={() => setDialog({ type: 'form', group: g, key: Date.now() })}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Delete"
                      onClick={() => void remove(g)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {slug && dialog?.type === 'form' && (
        <GroupFormDialog
          key={dialog.key}
          slug={slug}
          group={dialog.group}
          onClose={close}
          onSaved={() => {
            close();
            void load();
          }}
        />
      )}
      {slug && dialog?.type === 'send' && (
        <SendInviteDialog
          slug={slug}
          group={dialog.group}
          onClose={close}
          onDone={() => void load()}
        />
      )}
      {slug && dialog?.type === 'members' && (
        <MembersDialog
          slug={slug}
          group={dialog.group}
          onClose={close}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}
