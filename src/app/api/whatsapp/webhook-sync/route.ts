import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { decrypt } from '@/lib/whatsapp/encryption';
import { GRAPH_BASE_URL } from '@/lib/whatsapp/meta-config';
import { canManageTenant } from '@/lib/whatsapp/embedded-signup';
import {
  planOverrideFix,
  readOverrides,
  webhookUrlFromHeaders,
  type OverrideState,
  type PhoneConfigResponse,
  type SubscribedAppsResponse,
} from '@/lib/whatsapp/webhook-override';

/**
 * POST /api/whatsapp/webhook-sync  { tenantSlug }
 *
 * Reads the webhook overrides on a tenant's WhatsApp account and phone number
 * (using the token already stored for the tenant) and re-points any override
 * that sends messages somewhere other than this CRM. Meta sends `messages` to
 * the phone override first, then the account override, then the app callback,
 * so a leftover override can swallow inbound messages.
 */

type AdminClient = ReturnType<typeof supabaseAdmin>;

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

class SyncError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

interface TenantRow {
  id: string;
  owner_user_id: string | null;
  waba_id: string | null;
  phone_number_id: string | null;
  access_token_enc: string | null;
  verify_token: string | null;
}

async function getSessionUserId(req: NextRequest): Promise<string | null> {
  const client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll() } }
  );
  const {
    data: { user },
  } = await client.auth.getUser();
  return user?.id ?? null;
}

async function loadAuthorizedTenant(
  db: AdminClient,
  userId: string,
  slug: string
): Promise<TenantRow> {
  const { data: tenant, error } = await db
    .from('crm_tenants')
    .select(
      'id, owner_user_id, waba_id, phone_number_id, access_token_enc, verify_token'
    )
    .eq('slug', slug)
    .maybeSingle();
  if (error)
    throw new SyncError(`Could not load tenant: ${error.message}`, 500);
  if (!tenant) throw new SyncError(`Tenant "${slug}" not found`, 404);

  const { data: admin } = await db
    .from('crm_platform_admins')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  const allowed = canManageTenant({
    isPlatformAdmin: Boolean(admin),
    ownerUserId: tenant.owner_user_id,
    userId,
  });
  if (!allowed)
    throw new SyncError('You are not allowed to manage this tenant', 403);
  return tenant as TenantRow;
}

/** The tenant's own verify token (plain or encrypted); generated if missing. */
async function resolveVerifyToken(
  db: AdminClient,
  tenant: TenantRow
): Promise<string> {
  if (tenant.verify_token) {
    try {
      return decrypt(tenant.verify_token);
    } catch {
      return tenant.verify_token;
    }
  }
  const generated = randomBytes(16).toString('hex');
  const { error } = await db
    .from('crm_tenants')
    .update({ verify_token: generated })
    .eq('id', tenant.id);
  if (error)
    throw new SyncError(`Could not save verify token: ${error.message}`, 500);
  return generated;
}

async function graph<T>(
  path: string,
  token: string,
  init?: { method: 'POST'; body: unknown }
): Promise<T> {
  const res = await fetch(`${GRAPH_BASE_URL}/${path}`, {
    method: init?.method ?? 'GET',
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init ? JSON.stringify(init.body) : undefined,
  });
  const data = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new SyncError(
      data.error?.message ?? `Meta request failed (${path})`,
      502
    );
  }
  return data;
}

async function readState(
  tenant: TenantRow,
  token: string
): Promise<OverrideState> {
  const [subscribed, phone] = await Promise.all([
    graph<SubscribedAppsResponse>(`${tenant.waba_id}/subscribed_apps`, token),
    graph<PhoneConfigResponse>(
      `${tenant.phone_number_id}?fields=webhook_configuration`,
      token
    ),
  ]);
  return readOverrides(subscribed, phone, process.env.META_APP_ID ?? '');
}

async function applyFix(
  tenant: TenantRow,
  token: string,
  desired: string,
  verifyToken: string,
  plan: { fixPhone: boolean; fixWaba: boolean }
): Promise<void> {
  if (plan.fixPhone) {
    await graph(`${tenant.phone_number_id}`, token, {
      method: 'POST',
      body: {
        webhook_configuration: {
          override_callback_uri: desired,
          verify_token: verifyToken,
        },
      },
    });
  }
  if (plan.fixWaba) {
    await graph(`${tenant.waba_id}/subscribed_apps`, token, {
      method: 'POST',
      body: { override_callback_uri: desired, verify_token: verifyToken },
    });
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getSessionUserId(req);
    if (!userId) throw new SyncError('Unauthorized', 401);

    const body = (await req.json().catch(() => null)) as {
      tenantSlug?: string;
    } | null;
    if (!body?.tenantSlug) throw new SyncError('tenantSlug is required', 400);

    const db = supabaseAdmin();
    const tenant = await loadAuthorizedTenant(db, userId, body.tenantSlug);
    if (
      !tenant.waba_id ||
      !tenant.phone_number_id ||
      !tenant.access_token_enc
    ) {
      throw new SyncError(
        'This tenant has no stored connection yet. Save its credentials first.',
        400
      );
    }

    const desired = webhookUrlFromHeaders(
      req.headers,
      process.env.NEXT_PUBLIC_SITE_URL
    );
    if (!desired) {
      throw new SyncError(
        'Run this from the public https site: Meta only accepts https callbacks.',
        400
      );
    }

    const token = decrypt(tenant.access_token_enc);
    const before = await readState(tenant, token);
    const plan = planOverrideFix(before, desired);

    if (!plan.fixPhone && !plan.fixWaba) {
      return NextResponse.json({
        webhookUrl: desired,
        before,
        after: before,
        changed: { phone: false, waba: false },
      });
    }

    const verifyToken = await resolveVerifyToken(db, tenant);
    await applyFix(tenant, token, desired, verifyToken, plan);
    const after = await readState(tenant, token);

    return NextResponse.json({
      webhookUrl: desired,
      before,
      after,
      changed: { phone: plan.fixPhone, waba: plan.fixWaba },
    });
  } catch (error) {
    if (error instanceof SyncError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }
    console.error('[webhook-sync] unexpected failure:', error);
    return NextResponse.json({ error: 'Webhook sync failed' }, { status: 500 });
  }
}
