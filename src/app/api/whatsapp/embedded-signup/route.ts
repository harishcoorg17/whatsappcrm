import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { encrypt } from '@/lib/whatsapp/encryption';
import { GRAPH_BASE_URL } from '@/lib/whatsapp/meta-config';
import {
  canManageTenant,
  resolveSignupAssets,
} from '@/lib/whatsapp/embedded-signup';

type AdminClient = ReturnType<typeof supabaseAdmin>;

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

class SignupError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

interface SignupBody {
  code?: string | null;
  tenantSlug?: string;
  wabaId?: string;
  phoneNumberId?: string;
  /** Raw System User token. Skips the code exchange; platform admins only. */
  accessToken?: string;
  /** Hint from the browser for the audit log. Never used for authorization. */
  coexistence?: boolean;
}

interface TenantRow {
  id: string;
  owner_user_id: string | null;
}

async function graphGet<T>(
  path: string,
  params: Record<string, string>,
  bearer?: string
): Promise<T> {
  const url = `${GRAPH_BASE_URL}/${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, {
    cache: 'no-store',
    headers: bearer ? { Authorization: `Bearer ${bearer}` } : undefined,
  });
  const data = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new SignupError(
      data.error?.message ?? `Graph request failed (${path})`,
      400
    );
  }
  return data;
}

async function getSessionUserId(req: NextRequest): Promise<string | null> {
  const userClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll() } }
  );
  const {
    data: { user },
  } = await userClient.auth.getUser();
  return user?.id ?? null;
}

async function isPlatformAdmin(
  db: AdminClient,
  userId: string
): Promise<boolean> {
  const { data, error } = await db
    .from('crm_platform_admins')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.error(
      '[embedded-signup] platform admin lookup failed:',
      error.message
    );
    return false;
  }
  return Boolean(data);
}

async function authorizeTenant(
  db: AdminClient,
  userId: string,
  tenantSlug: string
): Promise<{ tenant: TenantRow; isAdmin: boolean }> {
  const { data: tenant, error } = await db
    .from('crm_tenants')
    .select('id, owner_user_id')
    .eq('slug', tenantSlug)
    .maybeSingle();
  if (error) {
    // A failed lookup is not the same as a missing tenant: report it as a
    // server problem so a bad service key or missing grant is not hidden.
    console.error('[embedded-signup] tenant lookup failed:', error.message);
    throw new SignupError(`Could not load tenant: ${error.message}`, 500);
  }
  if (!tenant) throw new SignupError(`Tenant "${tenantSlug}" not found`, 404);

  const isAdmin = await isPlatformAdmin(db, userId);
  const allowed = canManageTenant({
    isPlatformAdmin: isAdmin,
    ownerUserId: tenant.owner_user_id,
    userId,
  });
  if (!allowed) {
    throw new SignupError('You are not allowed to connect this tenant', 403);
  }
  return { tenant, isAdmin };
}

/** Exchanges the Embedded Signup code (valid ~30s) for a business token. */
async function exchangeCodeForToken(code: string): Promise<string> {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    throw new SignupError('META_APP_ID or META_APP_SECRET not configured', 500);
  }

  // No redirect_uri: the FB.login popup flow issues the code against Meta's own
  // internal redirect, and sending ours makes Meta reject the exchange.
  const short = await graphGet<{ access_token?: string }>(
    'oauth/access_token',
    { client_id: appId, client_secret: appSecret, code }
  );
  if (!short.access_token)
    throw new SignupError('Failed to exchange code', 400);

  try {
    const long = await graphGet<{ access_token?: string }>(
      'oauth/access_token',
      {
        grant_type: 'fb_exchange_token',
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: short.access_token,
      }
    );
    return long.access_token ?? short.access_token;
  } catch {
    return short.access_token;
  }
}

/** WABA ids Meta granted to this token, taken from `debug_token`. */
async function grantedWabaIds(token: string): Promise<string[]> {
  const appId = process.env.META_APP_ID!;
  const appSecret = process.env.META_APP_SECRET!;
  const { data } = await graphGet<{
    data: {
      is_valid: boolean;
      app_id: string;
      granular_scopes?: Array<{ scope: string; target_ids?: string[] }>;
    };
  }>('debug_token', {
    input_token: token,
    access_token: `${appId}|${appSecret}`,
  });

  if (!data.is_valid || data.app_id !== appId) {
    throw new SignupError('The access token was not issued to this app', 400);
  }
  return (
    data.granular_scopes
      ?.filter(
        (s) =>
          s.scope === 'whatsapp_business_management' ||
          s.scope === 'whatsapp_business_messaging'
      )
      .flatMap((s) => s.target_ids ?? []) ?? []
  );
}

async function listPhoneNumberIds(
  wabaId: string,
  token: string
): Promise<string[]> {
  const { data } = await graphGet<{ data?: Array<{ id: string }> }>(
    `${wabaId}/phone_numbers`,
    { fields: 'id', limit: '50' },
    token
  );
  return (data ?? []).map((p) => p.id);
}

async function resolvePhoneNumberId(
  wabaId: string,
  claimed: string,
  token: string
): Promise<string> {
  const ids = await listPhoneNumberIds(wabaId, token);
  if (claimed) {
    if (!ids.includes(claimed)) {
      throw new SignupError(
        'The phone number does not belong to this WhatsApp Business Account',
        400
      );
    }
    return claimed;
  }
  if (ids.length === 1) return ids[0];
  throw new SignupError(
    ids.length === 0
      ? 'No phone number was found on this WhatsApp Business Account'
      : 'Several phone numbers were found; finish the signup again and select one',
    400
  );
}

/**
 * Finds the WhatsApp Business Account that holds `phoneNumberId`.
 *
 * The id typed by an admin is tried first, then every account Meta says the
 * token can reach. Business Settings lists several look-alike ids (messaging
 * accounts, WhatsApp accounts), so a wrong guess must not fail the save: only
 * an account that really lists the number is accepted.
 */
async function findWabaForPhone(
  token: string,
  claimedWabaId: string,
  phoneNumberId: string
): Promise<string> {
  let granted: string[] = [];
  try {
    granted = await grantedWabaIds(token);
  } catch (error) {
    // A token from a different app would subscribe that app to the account,
    // so webhooks would never reach us. Any other lookup failure is tolerated.
    if (error instanceof SignupError && error.message.includes('not issued')) {
      throw error;
    }
  }

  const candidates = Array.from(
    new Set([claimedWabaId, ...granted].filter(Boolean))
  );
  // Keep what happened to each candidate so a failure explains itself instead
  // of leaving the admin to guess (ids and Meta's own wording only, no secrets).
  const attempts: string[] = [];
  for (const wabaId of candidates) {
    try {
      const ids = await listPhoneNumberIds(wabaId, token);
      if (ids.includes(phoneNumberId)) return wabaId;
      attempts.push(`${wabaId}: lists ${ids.length} number(s), not this one`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unreachable';
      attempts.push(`${wabaId}: ${reason}`);
    }
  }
  const tried =
    attempts.length > 0
      ? ` Tried: ${attempts.join(' | ')}`
      : ' The token lists no accounts and none was typed.';
  throw new SignupError(
    'Could not find a WhatsApp Business Account holding this phone number. ' +
      'Check that the token’s system user has Full control of the account that owns the number.' +
      tried,
    400
  );
}

async function assertPhoneNotUsedElsewhere(
  db: AdminClient,
  phoneNumberId: string,
  tenantId: string
): Promise<void> {
  const { data } = await db
    .from('crm_tenants')
    .select('id')
    .eq('phone_number_id', phoneNumberId)
    .neq('id', tenantId)
    .maybeSingle();
  if (data) {
    throw new SignupError(
      'This phone number is already connected to another tenant',
      409
    );
  }
}

/** Without this subscription Meta never delivers the customer's webhooks. */
async function subscribeAppToWaba(
  wabaId: string,
  token: string
): Promise<void> {
  const res = await fetch(`${GRAPH_BASE_URL}/${wabaId}/subscribed_apps`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const data = (await res.json()) as {
    success?: boolean;
    error?: { message?: string };
  };
  if (!res.ok || !data.success) {
    throw new SignupError(
      `Could not subscribe the app to the WhatsApp Business Account: ${data.error?.message ?? 'unknown error'}`,
      502
    );
  }
}

async function connectTenant(
  db: AdminClient,
  params: {
    tenant: TenantRow;
    tenantSlug: string;
    userId: string;
    wabaId: string;
    phoneNumberId: string;
    token: string;
    coexistence: boolean;
    method: 'code' | 'direct_token';
  }
): Promise<void> {
  const { tenant, tenantSlug, userId, wabaId, phoneNumberId, token } = params;

  const { error } = await db
    .from('crm_tenants')
    .update({
      waba_id: wabaId,
      phone_number_id: phoneNumberId,
      access_token_enc: await encrypt(token),
      status: 'active',
      // Never replace an existing owner: only claim an unowned tenant.
      owner_user_id: tenant.owner_user_id ?? userId,
    })
    .eq('slug', tenantSlug);
  if (error) throw new SignupError(error.message, 500);

  await db.from('embedded_signup_events').insert({
    tenant_id: tenant.id,
    event_type: params.coexistence ? 'completed_coexistence' : 'completed',
    waba_id: wabaId,
    phone_number_id: phoneNumberId,
    raw_payload: { method: params.method, connectedBy: userId },
  });
}

async function connectWithCode(
  db: AdminClient,
  body: SignupBody,
  tenantSlug: string,
  userId: string,
  tenant: TenantRow
) {
  const token = await exchangeCodeForToken(body.code!);
  const assets = resolveSignupAssets({
    claimedWabaId: body.wabaId?.trim() ?? '',
    grantedWabaIds: await grantedWabaIds(token),
  });
  if (!assets.ok) throw new SignupError(assets.error, 400);

  const phoneNumberId = await resolvePhoneNumberId(
    assets.wabaId,
    body.phoneNumberId?.trim() ?? '',
    token
  );
  await assertPhoneNotUsedElsewhere(db, phoneNumberId, tenant.id);
  await subscribeAppToWaba(assets.wabaId, token);

  const coexistence = body.coexistence === true;
  await connectTenant(db, {
    tenant,
    tenantSlug,
    userId,
    wabaId: assets.wabaId,
    phoneNumberId,
    token,
    coexistence,
    method: 'code',
  });
  return { wabaId: assets.wabaId, phoneNumberId, coexistence };
}

async function connectWithDirectToken(
  db: AdminClient,
  body: SignupBody,
  tenantSlug: string,
  userId: string,
  tenant: TenantRow
) {
  const claimedPhone = body.phoneNumberId?.trim() ?? '';
  if (!claimedPhone) {
    throw new SignupError('phoneNumberId is required with a direct token', 400);
  }
  const token = body.accessToken!.trim();
  const wabaId = await findWabaForPhone(
    token,
    body.wabaId?.trim() ?? '',
    claimedPhone
  );
  const phoneNumberId = await resolvePhoneNumberId(wabaId, claimedPhone, token);
  await assertPhoneNotUsedElsewhere(db, phoneNumberId, tenant.id);
  await subscribeAppToWaba(wabaId, token);

  await connectTenant(db, {
    tenant,
    tenantSlug,
    userId,
    wabaId,
    phoneNumberId,
    token,
    coexistence: false,
    method: 'direct_token',
  });
  return { wabaId, phoneNumberId, coexistence: false };
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getSessionUserId(req);
    if (!userId) throw new SignupError('Unauthorized', 401);

    const body = (await req.json().catch(() => null)) as SignupBody | null;
    if (!body?.tenantSlug) throw new SignupError('tenantSlug is required', 400);

    const db = supabaseAdmin();
    const { tenant, isAdmin } = await authorizeTenant(
      db,
      userId,
      body.tenantSlug
    );

    if (body.accessToken && !body.code) {
      if (!isAdmin) {
        throw new SignupError(
          'Only platform admins can connect with a raw token',
          403
        );
      }
      return NextResponse.json(
        await connectWithDirectToken(db, body, body.tenantSlug, userId, tenant)
      );
    }

    if (!body.code) throw new SignupError('code is required', 400);
    return NextResponse.json(
      await connectWithCode(db, body, body.tenantSlug, userId, tenant)
    );
  } catch (error) {
    if (error instanceof SignupError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }
    console.error('[embedded-signup] unexpected failure:', error);
    return NextResponse.json({ error: 'Signup failed' }, { status: 500 });
  }
}
