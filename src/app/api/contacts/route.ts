import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/contacts  { name?, phone, email? }
 *
 * Runs as the signed-in user, so row-level security decides what they can see
 * and write: the contact is owned by them (`user_id`) and filed under the
 * oldest tenant they own. A user who owns no tenant can still create contacts;
 * they are just not tied to one.
 */

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

async function findOwnedTenantId(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data } = await supabase
    .from('crm_tenants')
    .select('id')
    .eq('owner_user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
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

  const tenantId = await findOwnedTenantId(supabase, user.id);

  const { data, error } = await supabase
    .from('contacts')
    .insert({
      user_id: user.id,
      tenant_id: tenantId,
      name: name?.trim() || null,
      phone: phone.trim(),
      email: email?.trim() || null,
    })
    .select('id')
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id }, { status: 201 });
}
