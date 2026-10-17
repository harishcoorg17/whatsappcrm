import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { encrypt } from '@/lib/whatsapp/encryption';

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
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

  // With sessionInfoVersion:'3' the frontend SDK callback includes waba_id
  // and phone_number_id in session_info — use those directly. Calling
  // me/whatsapp_business_accounts requires whatsapp_business_management
  // permission which may not be granted yet in Development mode.
  const wabaId: string = wabaIdFromSession ?? '';
  const phoneNumberId: string = phoneNumberIdFromSession ?? '';

  if (!wabaId) {
    return NextResponse.json(
      {
        error:
          'No WABA ID returned from session info — ensure sessionInfoVersion:3 is set in FB.login extras',
      },
      { status: 400 }
    );
  }

  // Encrypt token and persist
  const encryptedToken = await encrypt(shortToken);
  const db = supabaseAdmin();
  const { error: dbError } = await db
    .from('crm_tenants')
    .update({
      waba_id: wabaId,
      phone_number_id: phoneNumberId,
      access_token_enc: encryptedToken,
      status: 'active',
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
