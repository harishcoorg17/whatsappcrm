import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { generateApiKey } from '@/lib/integrations/api-key';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { createClient } from '@/lib/supabase/server';
import { canManageTenant } from '@/lib/whatsapp/embedded-signup';

/**
 * Manage a tenant's integration API keys (used by server-to-server callers
 * such as the Amstago backend).
 *
 *   GET    /api/tenants/[slug]/api-keys          list keys (never secrets)
 *   POST   /api/tenants/[slug]/api-keys          create { label? }; the key is
 *                                                shown ONCE in the response
 *   DELETE /api/tenants/[slug]/api-keys?id=<id>  revoke
 *
 * Allowed for the tenant's owner and platform admins. Only a SHA-256 hash of a
 * key is stored, so a lost key cannot be recovered: revoke it and make a new
 * one.
 */

const MAX_ACTIVE_KEYS = 10;
const MAX_LABEL_LENGTH = 60;
const DEFAULT_LABEL = 'Backend';
const LIST_COLUMNS =
  'id, label, key_prefix, created_at, last_used_at, revoked_at';

type Context = { params: Promise<{ slug: string }> };
type Authorized =
  | {
      ok: true;
      userId: string;
      tenantId: string;
      db: ReturnType<typeof supabaseAdmin>;
    }
  | { ok: false; response: NextResponse };

function problem(
  message: string,
  status: number
): { ok: false; response: NextResponse } {
  return {
    ok: false,
    response: NextResponse.json({ error: message }, { status }),
  };
}

async function authorize(context: Context): Promise<Authorized> {
  const { slug } = await context.params;

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return problem('Unauthorized', 401);

  const db = supabaseAdmin();
  const { data: tenant, error: tenantError } = await db
    .from('crm_tenants')
    .select('id, owner_user_id')
    .eq('slug', slug)
    .maybeSingle();
  if (tenantError) {
    console.error('[tenants/api-keys] lookup failed:', tenantError.message);
    return problem('Could not load tenant', 500);
  }
  if (!tenant) return problem('Tenant not found', 404);

  const { data: admin } = await db
    .from('crm_platform_admins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();
  const allowed = canManageTenant({
    isPlatformAdmin: Boolean(admin),
    ownerUserId: tenant.owner_user_id,
    userId: user.id,
  });
  if (!allowed)
    return problem('You are not allowed to manage this tenant', 403);

  return { ok: true, userId: user.id, tenantId: tenant.id, db };
}

export async function GET(_request: NextRequest, context: Context) {
  try {
    const auth = await authorize(context);
    if (!auth.ok) return auth.response;

    const { data, error } = await auth.db
      .from('crm_api_keys')
      .select(LIST_COLUMNS)
      .eq('tenant_id', auth.tenantId)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[tenants/api-keys] list failed:', error.message);
      return NextResponse.json(
        { error: 'Could not list keys' },
        { status: 500 }
      );
    }
    return NextResponse.json({ keys: data ?? [] });
  } catch (error) {
    console.error('[tenants/api-keys] unexpected error:', error);
    return NextResponse.json({ error: 'Could not list keys' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const auth = await authorize(context);
    if (!auth.ok) return auth.response;

    const limit = checkRateLimit(
      `tenant-api-keys:${auth.userId}`,
      RATE_LIMITS.tenantSelf
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      label?: unknown;
    } | null;
    const label =
      typeof body?.label === 'string' && body.label.trim()
        ? body.label.trim().slice(0, MAX_LABEL_LENGTH)
        : DEFAULT_LABEL;

    const { count } = await auth.db
      .from('crm_api_keys')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', auth.tenantId)
      .is('revoked_at', null);
    if ((count ?? 0) >= MAX_ACTIVE_KEYS) {
      return NextResponse.json(
        {
          error: `A tenant can have at most ${MAX_ACTIVE_KEYS} active keys. Revoke one first.`,
        },
        { status: 409 }
      );
    }

    const { key, prefix, hash } = generateApiKey();
    const { data: created, error } = await auth.db
      .from('crm_api_keys')
      .insert({
        tenant_id: auth.tenantId,
        label,
        key_prefix: prefix,
        key_hash: hash,
        created_by: auth.userId,
      })
      .select('id, label, key_prefix, created_at')
      .single();
    if (error || !created) {
      console.error('[tenants/api-keys] create failed:', error?.message);
      return NextResponse.json(
        { error: 'Could not create the key' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        key,
        id: created.id,
        label: created.label,
        prefix: created.key_prefix,
        created_at: created.created_at,
        note: 'Copy this key now. It is not stored and cannot be shown again.',
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[tenants/api-keys] unexpected error:', error);
    return NextResponse.json(
      { error: 'Could not create the key' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const auth = await authorize(context);
    if (!auth.ok) return auth.response;

    const id = request.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    // Scoped to this tenant: a key id from another tenant matches nothing.
    const { data: revoked, error } = await auth.db
      .from('crm_api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', auth.tenantId)
      .is('revoked_at', null)
      .select('id')
      .maybeSingle();
    if (error) {
      console.error('[tenants/api-keys] revoke failed:', error.message);
      return NextResponse.json(
        { error: 'Could not revoke the key' },
        { status: 500 }
      );
    }
    if (!revoked) {
      return NextResponse.json({ error: 'Key not found' }, { status: 404 });
    }
    return NextResponse.json({ revoked: true });
  } catch (error) {
    console.error('[tenants/api-keys] unexpected error:', error);
    return NextResponse.json(
      { error: 'Could not revoke the key' },
      { status: 500 }
    );
  }
}
