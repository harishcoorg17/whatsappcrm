import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';

async function resolveTenantId(userId: string): Promise<string | null> {
  const admin = supabaseAdmin();
  const { data: crmTenant } = await admin
    .from('crm_tenants')
    .select('slug')
    .eq('owner_user_id', userId)
    .maybeSingle();
  if (!crmTenant?.slug) return null;
  const { data: tenant } = await admin
    .from('tenants')
    .select('id')
    .eq('slug', crmTenant.slug)
    .maybeSingle();
  return tenant?.id ?? null;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body)
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  const { name, phone, email } = body as {
    name?: string;
    phone?: string;
    email?: string;
  };
  if (!phone?.trim())
    return NextResponse.json({ error: 'Phone is required' }, { status: 400 });

  const tenantId = await resolveTenantId(user.id);
  if (!tenantId) {
    return NextResponse.json(
      { error: 'Could not resolve tenant — check your account setup' },
      { status: 400 }
    );
  }

  const { data, error } = await supabaseAdmin()
    .from('contacts')
    .insert({
      tenant_id: tenantId,
      name: name?.trim() || null,
      phone: phone.trim(),
      email: email?.trim() || null,
      tags: [],
    })
    .select('id')
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id }, { status: 201 });
}
