import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { encrypt } from '@/lib/whatsapp/encryption';

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  // Capture the authenticated admin's user ID to store as owner_user_id on the tenant.
  // The middleware already enforces auth for this route; this is just reading the session.
  let ownerUserId: string | null = null;
  try {
    const userClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => req.cookies.getAll() } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    ownerUserId = user?.id ?? null;
  } catch {
    // non-fatal — webhook routing will still work once owner_user_id is set manually
  }

  const body = await req.json();
  const {
    code,
    tenantSlug,
    wabaId: wabaIdFromSession,
    phoneNumberId: phoneNumberIdFromSession,
  } = body as {
    code?: string;
    tenantSlug?: string;
    wabaId?: string;
    phoneNumberId?: string;
  };

  if (!code)
    return NextResponse.json({ error: 'code is required' }, { status: 400 });
  if (!tenantSlug)
    return NextResponse.json(
      { error: 'tenantSlug is required' },
      { status: 400 }
    );

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    return NextResponse.json(
      { error: 'META_APP_ID or META_APP_SECRET not configured' },
      { status: 500 }
    );
  }

  // Exchange code for short-lived access token.
  // Do NOT pass redirect_uri: for Embedded Signup popup flow (FB.login),
  // the code was generated with Meta's internal xd_arbiter URI as redirect_uri.
  // Passing our own domain here causes Meta to reject with a domain mismatch.
  const tokenRes = await fetch(
    `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&code=${code}`,
    { cache: 'no-store' }
  );
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.access_token) {
    return NextResponse.json(
      { error: tokenData.error?.message ?? 'Failed to exchange code' },
      { status: 400 }
    );
  }
  const shortToken: string = tokenData.access_token;

  // Upgrade the short-lived user token (~1 h) to a long-lived token (60 days)
  // so stored credentials don't expire immediately after onboarding.
  let longToken = shortToken;
  try {
    const llRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortToken}`,
      { cache: 'no-store' }
    );
    const llData = await llRes.json();
    if (llData.access_token) longToken = llData.access_token as string;
  } catch {
    // fall back to short-lived token
  }

  // ES v4: WABA/phone IDs come via postMessage (frontend) or session_info.
  // Fallback: discover from Graph API using the short-lived token so the flow
  // succeeds even when the postMessage event is dropped or delayed.
  let wabaId: string = wabaIdFromSession ?? '';
  let phoneNumberId: string = phoneNumberIdFromSession ?? '';

  if (!wabaId) {
    try {
      const bizRes = await fetch(
        'https://graph.facebook.com/v21.0/me/businesses?fields=whatsapp_business_accounts.limit(5){id,phone_numbers.limit(5){id}}&limit=5',
        {
          headers: { Authorization: `Bearer ${shortToken}` },
          cache: 'no-store',
        }
      );
      const bizData = await bizRes.json();
      const firstWaba =
        bizData?.data?.[0]?.whatsapp_business_accounts?.data?.[0];
      if (firstWaba?.id) {
        wabaId = firstWaba.id as string;
        if (!phoneNumberId && firstWaba.phone_numbers?.data?.[0]?.id) {
          phoneNumberId = firstWaba.phone_numbers.data[0].id as string;
        }
      }
    } catch {
      // discovery failed — fall through to the 400 below
    }
  }

  if (!wabaId) {
    return NextResponse.json(
      {
        error:
          'Could not determine WABA ID — complete the WhatsApp Business signup and try again',
      },
      { status: 400 }
    );
  }

  // Encrypt token and persist
  const encryptedToken = await encrypt(longToken);
  const db = supabaseAdmin();
  const { error: dbError } = await db
    .from('crm_tenants')
    .update({
      waba_id: wabaId,
      phone_number_id: phoneNumberId,
      access_token_enc: encryptedToken,
      status: 'active',
      ...(ownerUserId ? { owner_user_id: ownerUserId } : {}),
    })
    .eq('slug', tenantSlug);

  if (dbError)
    return NextResponse.json({ error: dbError.message }, { status: 500 });

  await db.from('embedded_signup_events').insert({
    event_type: 'completed',
    waba_id: wabaId,
    phone_number_id: phoneNumberId,
    raw_payload: { wabaId, phoneNumberId },
  });

  return NextResponse.json({ wabaId, phoneNumberId });
}
