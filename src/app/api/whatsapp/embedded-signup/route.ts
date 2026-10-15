import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { encrypt } from '@/lib/whatsapp/encryption'

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { code, tenantSlug } = body as { code?: string; tenantSlug?: string }

  if (!code) return NextResponse.json({ error: 'code is required' }, { status: 400 })
  if (!tenantSlug) return NextResponse.json({ error: 'tenantSlug is required' }, { status: 400 })

  const appId = process.env.META_APP_ID
  const appSecret = process.env.META_APP_SECRET
  if (!appId || !appSecret) {
    return NextResponse.json({ error: 'META_APP_ID or META_APP_SECRET not configured' }, { status: 500 })
  }

  // Exchange code for short-lived access token
  const tokenRes = await fetch(
    `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&code=${code}`,
    { cache: 'no-store' }
  )
  const tokenData = await tokenRes.json()
  if (!tokenRes.ok || !tokenData.access_token) {
    return NextResponse.json({ error: tokenData.error?.message ?? 'Failed to exchange code' }, { status: 400 })
  }
  const shortToken: string = tokenData.access_token

  // Fetch WABA(s) linked to this business
  const wabaRes = await fetch(
    `https://graph.facebook.com/v21.0/me/whatsapp_business_accounts?access_token=${shortToken}`,
    { cache: 'no-store' }
  )
  const wabaData = await wabaRes.json()
  if (!wabaRes.ok || !wabaData.data?.length) {
    return NextResponse.json(
      { error: wabaData.error?.message ?? 'No WhatsApp Business Accounts found' },
      { status: 400 }
    )
  }
  const wabaId: string = wabaData.data[0].id

  // Fetch phone numbers under this WABA
  const phoneRes = await fetch(
    `https://graph.facebook.com/v21.0/${wabaId}/phone_numbers?access_token=${shortToken}`,
    { cache: 'no-store' }
  )
  const phoneData = await phoneRes.json()
  const phoneNumberId: string = phoneData.data?.[0]?.id ?? ''

  // Encrypt token and persist
  const encryptedToken = await encrypt(shortToken)
  const db = supabaseAdmin()
  const { error: dbError } = await db
    .from('crm_tenants')
    .update({ waba_id: wabaId, phone_number_id: phoneNumberId, access_token_enc: encryptedToken, status: 'active' })
    .eq('slug', tenantSlug)

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })

  await db.from('embedded_signup_events').insert({
    event_type: 'completed',
    waba_id: wabaId,
    phone_number_id: phoneNumberId,
    raw_payload: { wabaId, phoneNumberId },
  })

  return NextResponse.json({ wabaId, phoneNumberId })
}
