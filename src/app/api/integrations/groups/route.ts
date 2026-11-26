import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { authenticateApiKey } from '@/lib/integrations/api-key';
import {
  parseGroupRegistration,
  registerPendingGroup,
} from '@/lib/integrations/group-registry';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { loadNumberCredentials, loadTenantNumberCredentials } from '@/lib/whatsapp/credentials';
import { getGroupInviteLink, INVITE_LINK_PATTERN } from '@/lib/whatsapp/groups-api';
import { startGroupCreation } from '@/lib/whatsapp-groups/auto-create';
import { GROUP_COLUMNS, supabaseGroupStore, type GroupRow } from '@/lib/whatsapp-groups/group-store';

/**
 * POST /api/integrations/groups
 *
 * Server-to-server: the Amstago backend registers a leader-created group trip
 * so it shows on the tenant's Groups page. The WhatsApp group is made by hand
 * later, so the row has no invite link yet. Authenticated with a per-tenant
 * API key; the tenant comes from the key.
 *
 *   { "reference": "<community trip id>",   // repeats are safe
 *     "name": "Kerala (Group – 2026-12-05)",
 *     "description": "...",                  // optional
 *     "capacity": 20,                        // optional
 *     "departure_date": "2026-12-05",        // optional
 *     "create_on_whatsapp": true }           // optional: have WhatsApp create the group now
 *
 * With create_on_whatsapp the group is created through the WhatsApp Groups API. That is
 * asynchronous: the response says "creating", and the invite link appears on the group a
 * moment later. Read it with GET /api/integrations/groups?reference=<reference>.
 * A repeat call retries a group whose creation failed and leaves a working one alone.
 */

function error(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

async function loadGroup(
  db: ReturnType<typeof supabaseAdmin>,
  tenantId: string,
  groupId: string
): Promise<GroupRow | null> {
  const { data } = await db
    .from('whatsapp_groups')
    .select(GROUP_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('id', groupId)
    .maybeSingle();
  return (data as GroupRow | null) ?? null;
}

/**
 * GET /api/integrations/groups?reference=<reference>
 * The group's state and invite link. If WhatsApp created the group but the link webhook has
 * not arrived (or was missed), the link is fetched from WhatsApp and saved.
 */
export async function GET(request: Request) {
  try {
    const db = supabaseAdmin();
    const auth = await authenticateApiKey(db, request.headers.get('authorization'));
    if (!auth) return error('unauthorized', 'Invalid or missing API key.', 401);

    const limit = checkRateLimit(`integration-group:${auth.keyId}`, RATE_LIMITS.integrationSend);
    if (!limit.success) return rateLimitResponse(limit);

    const reference = new URL(request.url).searchParams.get('reference')?.trim() ?? '';
    if (!reference || reference.length > 128) return error('invalid_request', 'reference is required.', 400);

    const { data } = await db
      .from('whatsapp_groups')
      .select(GROUP_COLUMNS)
      .eq('tenant_id', auth.tenantId)
      .eq('external_ref', reference)
      .maybeSingle();
    const group = data as GroupRow | null;
    if (!group) return error('not_found', 'No group with that reference.', 404);

    let inviteUrl = group.invite_url;
    let status = group.creation_status;
    if (!inviteUrl && status === 'creating' && group.wa_group_id) {
      // Read the link with the number that created the group.
      const credentials = group.wa_phone_number_id
        ? await loadNumberCredentials(db, auth.tenantId, group.wa_phone_number_id)
        : (await loadTenantNumberCredentials(db, auth.ownerUserId, auth.tenantId))[0] ?? null;
      const link = credentials
        ? await getGroupInviteLink({ groupId: group.wa_group_id, accessToken: credentials.accessToken }).catch(() => null)
        : null;
      if (link && INVITE_LINK_PATTERN.test(link)) {
        await supabaseGroupStore(db).update(group.id, { invite_url: link, creation_status: 'active', creation_error: null });
        inviteUrl = link;
        status = 'active';
      }
    }

    return NextResponse.json({
      ok: true,
      group: { id: group.id, reference, status, invite_url: inviteUrl },
    });
  } catch (err) {
    console.error('[integrations/groups] lookup error:', err);
    return error('internal_error', 'Could not process the request.', 500);
  }
}

export async function POST(request: Request) {
  try {
    const db = supabaseAdmin();

    const auth = await authenticateApiKey(db, request.headers.get('authorization'));
    if (!auth) return error('unauthorized', 'Invalid or missing API key.', 401);

    const limit = checkRateLimit(`integration-group:${auth.keyId}`, RATE_LIMITS.integrationSend);
    if (!limit.success) return rateLimitResponse(limit);

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return error('invalid_json', 'Request body must be valid JSON.', 400);
    }

    const parsed = parseGroupRegistration(raw);
    if (!parsed.ok) return error('invalid_request', parsed.error, 400);

    const result = await registerPendingGroup(db, auth.tenantId, parsed.value);
    if (!result.ok) return error('internal_error', result.message, 500);

    const httpStatus = result.status === 'created' ? 201 : 200;
    if (!parsed.value.createOnWhatsapp) {
      return NextResponse.json({ ok: true, status: result.status, group_id: result.groupId }, { status: httpStatus });
    }

    const store = supabaseGroupStore(db);
    const group = await loadGroup(db, auth.tenantId, result.groupId);
    if (!group) return error('internal_error', 'Could not load the group.', 500);
    const numbers = await loadTenantNumberCredentials(db, auth.ownerUserId, auth.tenantId);
    const creation = await startGroupCreation(group, { store, numbers });

    return NextResponse.json(
      {
        ok: true,
        status: result.status,
        group_id: result.groupId,
        creation: creation.ok ? creation.status : 'failed',
        ...(creation.ok ? {} : { creation_error: creation.message }),
      },
      { status: httpStatus }
    );
  } catch (err) {
    console.error('[integrations/groups] unexpected error:', err);
    return error('internal_error', 'Could not process the request.', 500);
  }
}
