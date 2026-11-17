import { NextRequest, NextResponse } from 'next/server';
import { authorizeTenantAccess, problem } from '@/lib/tenants/authorize-tenant';
import { validateGroupInput } from '@/lib/whatsapp-groups/invite-url';

/**
 *   PATCH  /api/tenants/[slug]/whatsapp-groups/[id]   edit (full payload)
 *   DELETE /api/tenants/[slug]/whatsapp-groups/[id]   delete (and its invites)
 */

type Context = { params: Promise<{ slug: string; id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS =
  'id, kind, name, invite_url, description, capacity, departure_date, is_active, created_at';

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { slug, id } = await context.params;
    if (!UUID.test(id)) return problem('Group not found', 404).response;
    const auth = await authorizeTenantAccess(slug, { allowTeamAdmins: true });
    if (!auth.ok) return auth.response;

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const parsed = validateGroupInput(body);
    if (!parsed.ok) return problem(parsed.error, 400).response;

    const { data, error } = await auth.db
      .from('whatsapp_groups')
      .update(parsed.value)
      .eq('id', id)
      .eq('tenant_id', auth.tenant.id)
      .select(COLUMNS)
      .maybeSingle();
    if (error) {
      console.error('[whatsapp-groups] update failed:', error.message);
      return problem('Could not save the group', 500).response;
    }
    if (!data) return problem('Group not found', 404).response;
    return NextResponse.json({ group: data });
  } catch (error) {
    console.error('[whatsapp-groups] unexpected error:', error);
    return problem('Could not save the group', 500).response;
  }
}

export async function DELETE(_request: NextRequest, context: Context) {
  try {
    const { slug, id } = await context.params;
    if (!UUID.test(id)) return problem('Group not found', 404).response;
    const auth = await authorizeTenantAccess(slug, { allowTeamAdmins: true });
    if (!auth.ok) return auth.response;

    const { data, error } = await auth.db
      .from('whatsapp_groups')
      .delete()
      .eq('id', id)
      .eq('tenant_id', auth.tenant.id)
      .select('id');
    if (error) {
      console.error('[whatsapp-groups] delete failed:', error.message);
      return problem('Could not delete the group', 500).response;
    }
    if (!data?.length) return problem('Group not found', 404).response;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[whatsapp-groups] unexpected error:', error);
    return problem('Could not delete the group', 500).response;
  }
}
