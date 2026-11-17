import { NextRequest, NextResponse } from 'next/server';
import { authorizeTenantAccess, problem } from '@/lib/tenants/authorize-tenant';

/**
 * One connected store.
 *   PATCH  /api/tenants/[slug]/stores/[id]   { enabled: boolean }
 *   DELETE /api/tenants/[slug]/stores/[id]   disconnect (its event log goes too)
 */

type Context = { params: Promise<{ slug: string; id: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { slug, id } = await context.params;
    const auth = await authorizeTenantAccess(slug, { allowTeamAdmins: true });
    if (!auth.ok) return auth.response;
    const body = (await request.json().catch(() => ({}))) as { enabled?: unknown };
    if (typeof body.enabled !== 'boolean') return problem('"enabled" must be true or false', 400).response;

    const { data, error } = await auth.db
      .from('crm_store_connections')
      .update({ enabled: body.enabled })
      .eq('id', id)
      .eq('tenant_id', auth.tenant.id)
      .select('id')
      .maybeSingle();
    if (error) return problem('Could not update the store', 500).response;
    if (!data) return problem('Store not found', 404).response;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[tenants/stores/id] patch failed:', error);
    return problem('Could not update the store', 500).response;
  }
}

export async function DELETE(_request: NextRequest, context: Context) {
  try {
    const { slug, id } = await context.params;
    const auth = await authorizeTenantAccess(slug, { allowTeamAdmins: true });
    if (!auth.ok) return auth.response;
    const { error } = await auth.db
      .from('crm_store_connections')
      .delete()
      .eq('id', id)
      .eq('tenant_id', auth.tenant.id);
    if (error) return problem('Could not disconnect the store', 500).response;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[tenants/stores/id] delete failed:', error);
    return problem('Could not disconnect the store', 500).response;
  }
}
