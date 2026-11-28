'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
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
import { Switch } from '@/components/ui/switch';
import { URL_HINTS } from '@/lib/whatsapp-groups/invite-url';
import { api, inputClass, type GroupKind, type GroupRow } from './api';

interface Props {
  slug: string;
  /** null = create. */
  group: GroupRow | null;
  onClose: () => void;
  onSaved: () => void;
}

/** Mount with a fresh `key` per open so the form resets. */
export function GroupFormDialog({ slug, group, onClose, onSaved }: Props) {
  const [kind, setKind] = useState<GroupKind>(group?.kind ?? 'group');
  const [name, setName] = useState(group?.name ?? '');
  const [url, setUrl] = useState(group?.invite_url ?? '');
  const [description, setDescription] = useState(group?.description ?? '');
  const [capacity, setCapacity] = useState(group?.capacity?.toString() ?? '');
  const [departure, setDeparture] = useState(group?.departure_date ?? '');
  const [active, setActive] = useState(group?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  // A new group is created on WhatsApp by default (Meta's official Groups API). Untick to paste a link instead.
  const [createNow, setCreateNow] = useState(true);
  const creating = !group && kind === 'group' && createNow;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const base = `/api/tenants/${encodeURIComponent(slug)}/whatsapp-groups`;
    const res = await api<{ creation?: { status: string; error?: string } }>(
      group ? `${base}/${group.id}` : base,
      {
        method: group ? 'PATCH' : 'POST',
        body: JSON.stringify({
          kind,
          name,
          ...(creating ? { create_on_whatsapp: true } : { invite_url: url }),
          description,
          capacity: capacity || null,
          departure_date: departure || null,
          is_active: active,
        }),
      }
    );
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    if (creating) {
      const creation = res.data.creation;
      if (creation?.status === 'failed') {
        // The group is saved; the page shows the reason and a retry button.
        toast.error(
          `Saved, but WhatsApp could not create it: ${creation.error ?? 'unknown reason'}`
        );
      } else {
        toast.success(
          'Asked WhatsApp to create the group. Its invite link appears shortly.'
        );
      }
    } else {
      toast.success(group ? 'Saved' : 'Added');
    }
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{group ? 'Edit' : 'Add'} group or channel</DialogTitle>
          <DialogDescription>
            {group
              ? 'Update the details or the invite link.'
              : 'Create the group on WhatsApp from here, or paste the link of one you made yourself.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="g-kind">Type</Label>
            <select
              id="g-kind"
              className={inputClass}
              value={kind}
              onChange={(e) => setKind(e.target.value as GroupKind)}
            >
              <option value="group">Group (a trip departure)</option>
              <option value="channel">Channel (broadcast updates)</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="g-name">Name</Label>
            <input
              id="g-name"
              className={inputClass}
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              placeholder="Goa · 12 Dec departure"
              required
            />
          </div>
          {!group && kind === 'group' && (
            <div className="flex items-start justify-between gap-3 rounded-lg border border-slate-700 p-3">
              <div>
                <Label htmlFor="g-create">Create it on WhatsApp now</Label>
                <p className="text-xs text-slate-500">
                  Uses Meta&apos;s official Groups API. Needs a number
                  registered on the Cloud API only (not the WhatsApp Business
                  app) with Official Business Account status. A group holds up
                  to 8 people.
                </p>
              </div>
              <Switch
                id="g-create"
                checked={createNow}
                onCheckedChange={setCreateNow}
              />
            </div>
          )}
          {!creating && (
            <div className="space-y-1.5">
              <Label htmlFor="g-url">Invite link</Label>
              <input
                id="g-url"
                className={inputClass}
                value={url}
                maxLength={300}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={
                  kind === 'group'
                    ? 'https://chat.whatsapp.com/…'
                    : 'https://whatsapp.com/channel/…'
                }
                required
              />
              <p className="text-xs text-slate-500">{URL_HINTS[kind]}</p>
            </div>
          )}
          {kind === 'group' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="g-date">Departure date</Label>
                <input
                  id="g-date"
                  type="date"
                  className={inputClass}
                  value={departure}
                  onChange={(e) => setDeparture(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="g-cap">Capacity</Label>
                <input
                  id="g-cap"
                  type="number"
                  min={1}
                  max={1024}
                  className={inputClass}
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  placeholder="30"
                />
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="g-desc">Notes (optional)</Label>
            <textarea
              id="g-desc"
              className={`${inputClass} h-20 py-2`}
              value={description}
              maxLength={500}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="g-active">Active (can be sent to customers)</Label>
            <Switch
              id="g-active"
              checked={active}
              onCheckedChange={setActive}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              {creating ? 'Create group' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
