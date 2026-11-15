import { NextRequest, NextResponse } from 'next/server';
import { authorizeTenantAccess, problem } from '@/lib/tenants/authorize-tenant';

/**
 * One team member.
 *
 *   PATCH  /api/tenants/[slug]/members/[userId]   { role: 'admin' | 'agent' }
 *   DELETE /api/tenants/[slug]/members/[userId]
 *
 * The owner and platform admins can change anyone. A team admin can only
 * manage agents, so admins cannot promote themselves or remove each other.
 * Removing a member also unassigns the conversations assigned to them in this
 * tenant, so nothing stays stuck on someone who can no longer see it.
 */

type Context = { params: Promise<{ slug: string; userId: string }> };
type Role = 'admin' | 'agent';

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { slug, userId } = await context.params;
    const auth = await authorizeTenantAccess(slug, { allowTeamAdmins: true });
    if (!auth.ok) return auth.response;

    const body = (await request.json().catch(() => ({}))) as { role?: unknown };
    if (body.role !== 'admin' && body.role !== 'agent') {
      return problem('Role must be admin or agent', 400).response;
    }
    const role: Role = body.role;

    const { data: member } = await auth.db
      .from('crm_tenant_members')
      .select('user_id, role')
      .eq('tenant_id', auth.tenant.id)
      .eq('user_id', userId)
      .maybeSingle();
    if (!member) return problem('Team member not found', 404).response;

    if (auth.level !== 'owner') {
      if (userId === auth.userId) {
        return problem('You cannot change your own role', 403).response;
      }
      if (member.role === 'admin' || role === 'admin') {
        return problem('Only the owner can change admin roles', 403).response;
      }
    }

    const { error } = await auth.db
      .from('crm_tenant_members')
      .update({ role })
      .eq('tenant_id', auth.tenant.id)
      .eq('user_id', userId);
    if (error) {
      console.error('[tenants/members] role change failed:', error.message);
      return problem('Could not change the role', 500).response;
    }
    return NextResponse.json({ member: { user_id: userId, role } });
  } catch (error) {
    console.error('[tenants/members] unexpected error:', error);
    return problem('Could not change the role', 500).response;
  }
}

export async function DELETE(_request: NextRequest, context: Context) {
  try {
    const { slug, userId } = await context.params;
    const auth = await authorizeTenantAccess(slug, { allowTeamAdmins: true });
    if (!auth.ok) return auth.response;

    const { data: member } = await auth.db
      .from('crm_tenant_members')
      .select('user_id, role')
      .eq('tenant_id', auth.tenant.id)
      .eq('user_id', userId)
      .maybeSingle();
    if (!member) return problem('Team member not found', 404).response;

    if (auth.level !== 'owner' && member.role === 'admin') {
      return problem('Only the owner can remove an admin', 403).response;
    }

    const { error } = await auth.db
      .from('crm_tenant_members')
      .delete()
      .eq('tenant_id', auth.tenant.id)
      .eq('user_id', userId);
    if (error) {
      console.error('[tenants/members] remove failed:', error.message);
      return problem('Could not remove the team member', 500).response;
    }

    // Best effort: a failed unassign must not undo the removal.
    const { error: unassignError } = await auth.db
      .from('conversations')
      .update({ assigned_agent_id: null })
      .eq('tenant_id', auth.tenant.id)
      .eq('assigned_agent_id', userId);
    if (unassignError) {
      console.warn(
        '[tenants/members] could not unassign conversations:',
        unassignError.message
      );
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error('[tenants/members] unexpected error:', error);
    return problem('Could not remove the team member', 500).response;
  }
}
