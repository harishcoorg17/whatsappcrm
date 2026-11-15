'use client';

import { useCallback, useEffect, useState } from 'react';
import { UserPlus, Users } from 'lucide-react';
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

type MemberRole = 'owner' | 'admin' | 'agent';

interface TeamMember {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: MemberRole;
}

interface TeamDialogProps {
  tenant: { slug: string; name: string } | null;
  onClose: () => void;
}

const ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  agent: 'Agent',
};

async function request<T>(
  url: string,
  init?: RequestInit
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
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

/**
 * Manage who works a tenant's inbox. Agents handle conversations; admins also
 * manage the team. The owner is listed but cannot be changed here.
 */
export function TeamDialog({ tenant, onClose }: TeamDialogProps) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'agent' | 'admin'>('agent');

  const slug = tenant?.slug ?? null;
  const base = slug ? `/api/tenants/${encodeURIComponent(slug)}/members` : null;

  const load = useCallback(async () => {
    if (!base) return;
    setLoading(true);
    const result = await request<{ members: TeamMember[] }>(base);
    setLoading(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setMembers(result.data.members);
  }, [base]);

  useEffect(() => {
    if (!slug) return;
    setMembers([]);
    setEmail('');
    setRole('agent');
    void load();
  }, [slug, load]);

  const addMember = async () => {
    if (!base) return;
    if (!email.trim()) {
      toast.error('Enter an email address');
      return;
    }
    setAdding(true);
    const result = await request<{ invited: boolean }>(base, {
      method: 'POST',
      body: JSON.stringify({ email: email.trim(), role }),
    });
    setAdding(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(
      result.data.invited
        ? 'Invite email sent. They join the team when they sign in.'
        : 'Team member added'
    );
    setEmail('');
    void load();
  };

  const changeRole = async (member: TeamMember, next: 'admin' | 'agent') => {
    if (!base) return;
    setBusyId(member.user_id);
    const result = await request(`${base}/${member.user_id}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: next }),
    });
    setBusyId(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('Role updated');
    void load();
  };

  const removeMember = async (member: TeamMember) => {
    if (!base) return;
    const name = member.full_name ?? member.email ?? 'this person';
    if (
      !window.confirm(
        `Remove ${name} from the team? Conversations assigned to them become unassigned.`
      )
    ) {
      return;
    }
    setBusyId(member.user_id);
    const result = await request(`${base}/${member.user_id}`, {
      method: 'DELETE',
    });
    setBusyId(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('Removed from the team');
    void load();
  };

  return (
    <Dialog
      open={tenant !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-xl border-slate-800 bg-slate-950 text-white">
        <DialogHeader>
          <DialogTitle>Team — {tenant?.name}</DialogTitle>
        </DialogHeader>
        <p className="-mt-2 text-xs text-slate-400">
          Agents answer conversations in this tenant&apos;s inbox. Admins can
          also manage the team. Settings, templates, broadcasts and automations
          stay with the owner.
        </p>

        <div className="space-y-2">
          {loading && members.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400">Loading…</p>
          ) : members.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400">
              No one yet. Add your first team member below.
            </p>
          ) : (
            members.map((m) => (
              <div
                key={m.user_id}
                className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900 p-3"
              >
                <Users className="text-primary h-4 w-4 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {m.full_name ?? m.email ?? 'Pending invite'}
                  </p>
                  {m.full_name && m.email && (
                    <p className="truncate text-xs text-slate-400">{m.email}</p>
                  )}
                </div>
                {m.role === 'owner' ? (
                  <span className="bg-primary/15 text-primary rounded-full px-2 py-0.5 text-[10px] font-semibold">
                    {ROLE_LABELS.owner}
                  </span>
                ) : (
                  <div className="flex flex-shrink-0 items-center gap-1.5">
                    <select
                      aria-label={`Role for ${m.email ?? 'member'}`}
                      value={m.role}
                      disabled={busyId === m.user_id}
                      onChange={(e) =>
                        changeRole(m, e.target.value as 'admin' | 'agent')
                      }
                      className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
                    >
                      <option value="agent">{ROLE_LABELS.agent}</option>
                      <option value="admin">{ROLE_LABELS.admin}</option>
                    </select>
                    <button
                      onClick={() => removeMember(m)}
                      disabled={busyId === m.user_id}
                      className="rounded-md border border-red-800 px-2 py-1 text-xs text-red-400 hover:bg-red-950/40 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div className="space-y-3 border-t border-slate-800 pt-4">
          <p className="text-sm font-medium">Add a team member</p>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="agent@company.com"
                autoComplete="off"
                className="border-slate-700 bg-slate-900 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as 'agent' | 'admin')}
                className="h-9 rounded-md border border-slate-700 bg-slate-900 px-2 text-sm text-slate-200"
              >
                <option value="agent">{ROLE_LABELS.agent}</option>
                <option value="admin">{ROLE_LABELS.admin}</option>
              </select>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            If they don&apos;t have an account yet, we email them an invite and
            they join this team when they sign in.
          </p>
          <div className="flex justify-end">
            <Button onClick={addMember} disabled={adding} className="gap-2">
              <UserPlus className="h-4 w-4" />
              {adding ? 'Adding…' : 'Add to team'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
