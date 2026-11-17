'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api, inputClass, type GroupRow } from './api';

type Status = 'sent' | 'joined' | 'left';

interface Invite {
  contact_id: string;
  status: Status;
  sent_at: string;
  contact: { name: string | null; phone: string } | null;
}

interface Props {
  slug: string;
  group: GroupRow;
  onClose: () => void;
  onChanged: () => void;
}

export function MembersDialog({ slug, group, onClose, onChanged }: Props) {
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const base = `/api/tenants/${encodeURIComponent(slug)}/whatsapp-groups/${group.id}/invites`;

  const load = useCallback(async () => {
    const res = await api<{ invites: Invite[] }>(base);
    if (!res.ok) {
      toast.error(res.error);
      setInvites([]);
      return;
    }
    setInvites(res.data.invites);
  }, [base]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const mark = async (contactId: string, status: Status) => {
    const res = await api(base, {
      method: 'PATCH',
      body: JSON.stringify({ contactId, status }),
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setInvites((prev) =>
      (prev ?? []).map((i) => (i.contact_id === contactId ? { ...i, status } : i))
    );
    onChanged();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invited: {group.name}</DialogTitle>
          <DialogDescription>
            WhatsApp does not tell us who joins, so mark it yourself.
          </DialogDescription>
        </DialogHeader>
        {invites === null ? (
          <Loader2 className="mx-auto my-6 size-5 animate-spin" />
        ) : invites.length === 0 ? (
          <p className="text-sm text-slate-400">Nobody has been sent this link yet.</p>
        ) : (
          <ul className="max-h-80 divide-y divide-slate-800 overflow-y-auto">
            {invites.map((i) => (
              <li key={i.contact_id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-slate-100">
                    {i.contact?.name ?? i.contact?.phone ?? 'Contact'}
                  </p>
                  <p className="text-xs text-slate-500">
                    Sent {new Date(i.sent_at).toLocaleDateString()}
                  </p>
                </div>
                <Badge variant={i.status === 'joined' ? 'success' : 'secondary'}>
                  {i.status}
                </Badge>
                <select
                  aria-label="Mark status"
                  className={`${inputClass} w-24`}
                  value={i.status}
                  onChange={(e) => void mark(i.contact_id, e.target.value as Status)}
                >
                  <option value="sent">Sent</option>
                  <option value="joined">Joined</option>
                  <option value="left">Left</option>
                </select>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
