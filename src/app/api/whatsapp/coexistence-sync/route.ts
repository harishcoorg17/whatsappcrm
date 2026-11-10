import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { decrypt } from '@/lib/whatsapp/encryption';
import { GRAPH_BASE_URL } from '@/lib/whatsapp/meta-config';
import { canManageTenant } from '@/lib/whatsapp/embedded-signup';
import {
  META_SYNC_TYPE,
  SYNC_EVENT,
  SYNC_EVENT_TYPES,
  planSync,
  readSyncState,
  type SyncKind,
  type SyncState,
} from '@/lib/whatsapp/coexistence-sync';

/**
 * GET  /api/whatsapp/coexistence-sync?tenantSlug=…   → sync state
 * POST /api/whatsapp/coexistence-sync { tenantSlug, sync: 'contacts' | 'history' }
 *
 * Asks Meta to send a coexistence tenant's WhatsApp Business app contacts and
 * chat history to the webhook. Meta allows each once, contacts first, within
 * 24 hours of connecting, so every request is recorded and refused if it was
 * already made.
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
  phone_number_id: string | null;
  access_token_enc: string | null;
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
    .select('id, owner_user_id, phone_number_id, access_token_enc')
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

async function loadState(
  db: AdminClient,
  tenantId: string
): Promise<SyncState> {
  const { data, error } = await db
    .from('embedded_signup_events')
    .select('event_type, created_at')
    .eq('tenant_id', tenantId)
    .in('event_type', SYNC_EVENT_TYPES);
  if (error)
    throw new SyncError(`Could not read sync state: ${error.message}`, 500);
  return readSyncState(data ?? []);
}

async function metaCall<T>(
  path: string,
  token: string,
  init?: { body: unknown }
): Promise<T> {
  const res = await fetch(`${GRAPH_BASE_URL}/${path}`, {
    method: init ? 'POST' : 'GET',
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init ? JSON.stringify(init.body) : undefined,
  });
  const data = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new SyncError(data.error?.message ?? 'Meta request failed', 502);
  }
  return data;
}

/** The sync only works for a number that is really on the Business app. */
async function assertOnBusinessApp(
  phoneNumberId: string,
  token: string
): Promise<void> {
  const phone = await metaCall<{ is_on_biz_app?: boolean }>(
    `${phoneNumberId}?fields=is_on_biz_app,platform_type`,
    token
  );
  if (phone.is_on_biz_app !== true) {
    throw new SyncError(
      'This number is not connected to the WhatsApp Business app, so there is nothing to sync.',
      409
    );
  }
}

function readKind(value: unknown): SyncKind | null {
  return value === 'contacts' || value === 'history' ? value : null;
}

export async function GET(req: NextRequest) {
  try {
    const userId = await getSessionUserId(req);
    if (!userId) throw new SyncError('Unauthorized', 401);

    const slug = req.nextUrl.searchParams.get('tenantSlug');
    if (!slug) throw new SyncError('tenantSlug is required', 400);

    const db = supabaseAdmin();
    const tenant = await loadAuthorizedTenant(db, userId, slug);
    return NextResponse.json(await loadState(db, tenant.id));
  } catch (error) {
    return failure(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getSessionUserId(req);
    if (!userId) throw new SyncError('Unauthorized', 401);

    const body = (await req.json().catch(() => null)) as {
      tenantSlug?: string;
      sync?: unknown;
    } | null;
    if (!body?.tenantSlug) throw new SyncError('tenantSlug is required', 400);
    const kind = readKind(body.sync);
    if (!kind) throw new SyncError("sync must be 'contacts' or 'history'", 400);

    const db = supabaseAdmin();
    const tenant = await loadAuthorizedTenant(db, userId, body.tenantSlug);
    if (!tenant.phone_number_id || !tenant.access_token_enc) {
      throw new SyncError('This tenant has no stored connection yet.', 400);
    }

    const state = await loadState(db, tenant.id);
    const plan = planSync(state, kind);
    if (!plan.ok) throw new SyncError(plan.error, plan.status);

    const token = decrypt(tenant.access_token_enc);
    await assertOnBusinessApp(tenant.phone_number_id, token);

    const result = await metaCall<{ request_id?: string }>(
      `${tenant.phone_number_id}/smb_app_data`,
      token,
      {
        body: {
          messaging_product: 'whatsapp',
          sync_type: META_SYNC_TYPE[kind],
        },
      }
    );

    // Meta has accepted the request. If recording it fails we still report
    // success, because retrying would only be refused by Meta as a repeat.
    const { error: recordError } = await db
      .from('embedded_signup_events')
      .insert({
        tenant_id: tenant.id,
        event_type: SYNC_EVENT[kind],
        phone_number_id: tenant.phone_number_id,
        raw_payload: { request_id: result.request_id ?? null },
      });
    if (recordError) {
      console.error(
        '[coexistence-sync] could not record the request:',
        recordError.message
      );
    }

    return NextResponse.json({
      sync: kind,
      requestId: result.request_id ?? null,
      deadline: state.deadline,
      recorded: !recordError,
    });
  } catch (error) {
    return failure(error);
  }
}

function failure(error: unknown) {
  if (error instanceof SyncError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status }
    );
  }
  console.error('[coexistence-sync] unexpected failure:', error);
  return NextResponse.json(
    { error: 'Coexistence sync failed' },
    { status: 500 }
  );
}
