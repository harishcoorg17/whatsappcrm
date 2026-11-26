import { NextRequest, NextResponse } from 'next/server';
import { authorizeTenantAccess, problem } from '@/lib/tenants/authorize-tenant';
import { validateGroupInput } from '@/lib/whatsapp-groups/invite-url';

/**
 * A tenant's registry of WhatsApp groups and channels (created by hand in
 * the WhatsApp app; ConverMesh stores the invite links).
 *
 *   GET  /api/tenants/[slug]/whatsapp-groups   list with invite counts
 *   POST /api/tenants/[slug]/whatsapp-groups   create
 */

type Context = { params: Promise<{ slug: string }> };

const COLUMNS =
  'id, kind, name, invite_url, description, capacity, departure_date, is_active, created_at, creation_status, creation_error';
export const MAX_GROUPS_PER_TENANT = 500;

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { slug } = await context.params;
    const auth = await authorizeTenantAccess(slug, { allowTeamAdmins: true });
    if (!auth.ok) return auth.response;

    const { data, error } = await auth.db
      .from('whatsapp_groups')
      .select(COLUMNS)
      .eq('tenant_id', auth.tenant.id)
      .order('created_at', { ascending: false })
      .limit(MAX_GROUPS_PER_TENANT);
    if (error) {
      console.error('[whatsapp-groups] list failed:', error.message);
      return problem(
        'Could not load groups. Has migration 056 been applied?',
        500
      ).response;
    }
    const groups = (data ?? []) as Array<{ id: string }>;

    const counts = new Map<string, { invited: number; joined: number }>();
    if (groups.length > 0) {
      const { data: invites } = await auth.db
        .from('whatsapp_group_invites')
        .select('group_id, status')
        .in('group_id', groups.map((g) => g.id))
        .limit(50000);
      for (const row of (invites ?? []) as Array<{
        group_id: string;
        status: string;
      }>) {
        const current = counts.get(row.group_id) ?? { invited: 0, joined: 0 };
        counts.set(row.group_id, {
          invited: current.invited + 1,
          joined: current.joined + (row.status === 'joined' ? 1 : 0),
        });
      }
    }

    return NextResponse.json({
      groups: groups.map((g) => ({
        ...g,
        invite_count: counts.get(g.id)?.invited ?? 0,
        joined_count: counts.get(g.id)?.joined ?? 0,
      })),
    });
  } catch (error) {
    console.error('[whatsapp-groups] unexpected error:', error);
    return problem('Could not load groups', 500).response;
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const { slug } = await context.params;
    const auth = await authorizeTenantAccess(slug, { allowTeamAdmins: true });
    if (!auth.ok) return auth.response;

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const parsed = validateGroupInput(body);
    if (!parsed.ok) return problem(parsed.error, 400).response;

    const { count } = await auth.db
      .from('whatsapp_groups')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', auth.tenant.id);
    if ((count ?? 0) >= MAX_GROUPS_PER_TENANT) {
      return problem('You have reached the limit of groups and channels', 400)
        .response;
    }

    const { data, error } = await auth.db
      .from('whatsapp_groups')
      .insert({ ...parsed.value, tenant_id: auth.tenant.id })
      .select(COLUMNS)
      .single();
    if (error) {
      console.error('[whatsapp-groups] create failed:', error.message);
      return problem('Could not save the group', 500).response;
    }
    return NextResponse.json(
      { group: { ...data, invite_count: 0, joined_count: 0 } },
      { status: 201 }
    );
  } catch (error) {
    console.error('[whatsapp-groups] unexpected error:', error);
    return problem('Could not save the group', 500).response;
  }
}
