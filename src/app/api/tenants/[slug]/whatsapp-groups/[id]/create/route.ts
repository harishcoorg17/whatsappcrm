import { NextRequest, NextResponse } from 'next/server';
import { authorizeTenantAccess, problem } from '@/lib/tenants/authorize-tenant';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { loadTenantNumberCredentials } from '@/lib/whatsapp/credentials';
import { startGroupCreation } from '@/lib/whatsapp-groups/auto-create';
import {
  GROUP_COLUMNS,
  supabaseGroupStore,
  type GroupRow,
} from '@/lib/whatsapp-groups/group-store';

/**
 * POST /api/tenants/[slug]/whatsapp-groups/[id]/create
 * Asks WhatsApp to create this group now (the Groups API). The invite link arrives a moment
 * later by webhook. Also the retry for a group whose creation failed.
 */

type Context = { params: Promise<{ slug: string; id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CREATE_LIMIT = { limit: 10, windowMs: 60_000 };

export async function POST(_request: NextRequest, context: Context) {
  try {
    const { slug, id } = await context.params;
    if (!UUID.test(id)) return problem('Group not found', 404).response;
    const auth = await authorizeTenantAccess(slug, { allowTeamAdmins: true });
    if (!auth.ok) return auth.response;

    const limit = checkRateLimit(`group-create:${auth.userId}`, CREATE_LIMIT);
    if (!limit.success) return rateLimitResponse(limit);

    const { data } = await auth.db
      .from('whatsapp_groups')
      .select(`${GROUP_COLUMNS}, kind`)
      .eq('id', id)
      .eq('tenant_id', auth.tenant.id)
      .maybeSingle();
    const group = data as (GroupRow & { kind: string }) | null;
    if (!group) return problem('Group not found', 404).response;
    if (group.kind !== 'group')
      return problem('Only groups can be created on WhatsApp', 400).response;

    const ownerId = auth.tenant.owner_user_id;
    const numbers = ownerId
      ? await loadTenantNumberCredentials(auth.db, ownerId, auth.tenant.id)
      : [];
    const result = await startGroupCreation(group, {
      store: supabaseGroupStore(auth.db),
      numbers,
    });
    if (!result.ok) return problem(result.message, 502).response;
    return NextResponse.json({ status: result.status });
  } catch (error) {
    console.error('[whatsapp-groups] create error:', error);
    return problem('Could not create the group', 500).response;
  }
}
