'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface DeleteTenantDialogProps {
  tenant: { slug: string; name: string } | null;
  onClose: () => void;
  onDeleted: (slug: string) => void;
}

/**
 * Permanent tenant deletion. The user must type the tenant's slug, mirroring
 * the check the server makes, because deletion cascades to all of the
 * tenant's contacts, conversations and messages.
 */
export function DeleteTenantDialog({
  tenant,
  onClose,
  onDeleted,
}: DeleteTenantDialogProps) {
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const canDelete = tenant !== null && confirmText === tenant.slug;

  const close = () => {
    if (deleting) return;
    setConfirmText('');
    onClose();
  };

  const handleDelete = async () => {
    if (!tenant || !canDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/tenants/${encodeURIComponent(tenant.slug)}`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmSlug: confirmText }),
        }
      );
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(body.error ?? 'Could not delete tenant');
        return;
      }
      toast.success(`Deleted ${tenant.name}`);
      onDeleted(tenant.slug);
      setConfirmText('');
      onClose();
    } catch {
      toast.error('Network error — tenant was not deleted');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog
      open={tenant !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="max-w-md border-slate-800 bg-slate-950 text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-400">
            <AlertTriangle className="h-5 w-5" />
            Delete {tenant?.name}?
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-400">
          This permanently deletes the tenant and all of its contacts,
          conversations, messages, pipelines, broadcasts, automations and API
          keys. This cannot be undone.
        </p>
        <div className="space-y-1.5">
          <Label>
            Type <span className="font-mono text-white">{tenant?.slug}</span> to
            confirm
          </Label>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={tenant?.slug}
            autoComplete="off"
            className="border-slate-700 bg-slate-900 font-mono text-sm"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={close} disabled={deleting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={!canDelete || deleting}
          >
            {deleting ? 'Deleting…' : 'Delete tenant'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
