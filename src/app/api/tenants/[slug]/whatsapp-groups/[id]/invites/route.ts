import { NextRequest, NextResponse } from 'next/server';
import { authorizeTenantAccess, problem } from '@/lib/tenants/authorize-tenant';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { sendGroupInvites } from '@/lib/whatsapp-groups/send-invites';
import { MAX_INVITE_BATCH } from '@/lib/whatsapp-groups/eligibility';
import type { GroupKind } from '@/lib/whatsapp-groups/invite-url';

/**
 * Invites for one group / channel.
 *
 *   GET   .../[id]/invites   who was sent the link, with their status
 *   POST  .../[id]/invites   send the link: { contactIds?, tagId?,
 *                            templateName?, templateLanguage? }
 *   PATCH .../[id]/invites   manual mark: { contactId, status: 'sent' |
 *                            'joined' | 'left' } (WhatsApp does not tell us)
 */

type Context = { params: Promise<{ slug: string; id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ['sent', 'joined', 'left'] as const;
const SEND_LIMIT = { limit: 10, windowMs: 60_000 };

async function loadGroup(
  db: Awaited<ReturnType<typeof authorizeTenantAccess>> extends infer A
    ? A extends { ok: true; db: infer D }
      ? D
      : never
    : never,
  tenantId: string,
  id: string
) {
  const { data } = await db
    .from('whatsapp_groups')
    .select('id, kind, name, invite_url, is_active')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  return (data as {
    id: string;
    kind: GroupKind;
    name: string;
    invite_url: string;
    is_active: boolean;
  } | null) ?? null;
}

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { slug, id } = await context.params;
    if (!UUID.test(id)) return problem('Group not found', 404).response;
    const auth = await authorizeTenantAccess(slug, { allowTeamAdmins: true });
    if (!auth.ok) return auth.response;
    if (!(await loadGroup(auth.db, auth.tenant.id, id))) {
      return problem('Group not found', 404).response;
    }

    const { data, error } = await auth.db
      .from('whatsapp_group_invites')
      .select('contact_id, status, sent_at, contact:contacts(name, phone)')
      .eq('group_id', id)
      .order('sent_at', { ascending: false })
      .limit(1000);
    if (error) {
      console.error('[whatsapp-groups] invites list failed:', error.message);
      return problem('Could not load invites', 500).response;
    }
    return NextResponse.json({ invites: data ?? [] });
  } catch (error) {
    console.error('[whatsapp-groups] unexpected error:', error);
    return problem('Could not load invites', 500).response;
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const { slug, id } = await context.params;
    if (!UUID.test(id)) return problem('Group not found', 404).response;
    const auth = await authorizeTenantAccess(slug, { allowTeamAdmins: true });
    if (!auth.ok) return auth.response;

    const limit = checkRateLimit(`group-invite:${auth.userId}`, SEND_LIMIT);
    if (!limit.success) return rateLimitResponse(limit);

    const group = await loadGroup(auth.db, auth.tenant.id, id);
    if (!group) return problem('Group not found', 404).response;
    if (!auth.tenant.owner_user_id) {
      return problem('This workspace has no owner to send from', 400).response;
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const contactIds = Array.isArray(body.contactIds)
      ? body.contactIds.filter((v): v is string => typeof v === 'string' && UUID.test(v))
      : [];
    if (contactIds.length > MAX_INVITE_BATCH * 5) {
      return problem('Too many contacts selected', 400).response;
    }
    const tagId = typeof body.tagId === 'string' && UUID.test(body.tagId) ? body.tagId : null;
    const templateName =
      typeof body.templateName === 'string' && body.templateName.trim()
        ? body.templateName.trim().slice(0, 512)
        : null;
    const templateLanguage =
      typeof body.templateLanguage === 'string' ? body.templateLanguage.slice(0, 20) : null;

    const result = await sendGroupInvites(auth.db, {
      tenantId: auth.tenant.id,
      ownerUserId: auth.tenant.owner_user_id,
      group,
      contactIds,
      tagId,
      templateName,
      templateLanguage,
    });
    if (!result.ok) return problem(result.error, result.status).response;
    return NextResponse.json(result);
  } catch (error) {
    console.error('[whatsapp-groups] send failed:', error);
    return problem('Could not send the invites', 500).response;
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { slug, id } = await context.params;
    if (!UUID.test(id)) return problem('Group not found', 404).response;
    const auth = await authorizeTenantAccess(slug, { allowTeamAdmins: true });
    if (!auth.ok) return auth.response;
    if (!(await loadGroup(auth.db, auth.tenant.id, id))) {
      return problem('Group not found', 404).response;
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const status = STATUSES.find((s) => s === body.status);
    if (!status) return problem('status must be sent, joined or left', 400).response;
    if (typeof body.contactId !== 'string' || !UUID.test(body.contactId)) {
      return problem('contactId is required', 400).response;
    }

    const { data, error } = await auth.db
      .from('whatsapp_group_invites')
      .update({ status })
      .eq('group_id', id)
      .eq('contact_id', body.contactId)
      .select('contact_id, status');
    if (error) {
      console.error('[whatsapp-groups] mark failed:', error.message);
      return problem('Could not update the member', 500).response;
    }
    if (!data?.length) return problem('That contact has not been invited', 404).response;
    return NextResponse.json({ invite: data[0] });
  } catch (error) {
    console.error('[whatsapp-groups] unexpected error:', error);
    return problem('Could not update the member', 500).response;
  }
}
