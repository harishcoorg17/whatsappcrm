import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { createClient } from '@/lib/supabase/server';
import { canManageTenant } from '@/lib/whatsapp/embedded-signup';

/**
 * Resolve the signed-in user's access to a tenant by slug. Allowed for the
 * tenant's owner and for platform admins (same rule as the api-keys routes).
 */

export interface AuthorizedTenant {
  ok: true;
  userId: string;
  /**
   * 'owner' = the tenant's owner or a platform admin; 'admin' = a team admin
   * (only returned when the caller asked to allow team admins).
   */
  level: 'owner' | 'admin';
  tenant: {
    id: string;
    owner_user_id: string | null;
    phone_number_id: string | null;
    waba_id: string | null;
    access_token_enc: string | null;
  };
  db: ReturnType<typeof supabaseAdmin>;
}

export type TenantAccess =
  | AuthorizedTenant
  | { ok: false; response: NextResponse };

export function problem(
  message: string,
  status: number
): { ok: false; response: NextResponse } {
  return {
    ok: false,
    response: NextResponse.json({ error: message }, { status }),
  };
}

export async function authorizeTenantAccess(
  slug: string,
  options: { allowTeamAdmins?: boolean } = {}
): Promise<TenantAccess> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return problem('Unauthorized', 401);

  const db = supabaseAdmin();
  const { data: tenant, error: tenantError } = await db
    .from('crm_tenants')
    .select('id, owner_user_id, phone_number_id, waba_id, access_token_enc')
    .eq('slug', slug)
    .maybeSingle();
  if (tenantError) {
    console.error('[tenants/authorize] lookup failed:', tenantError.message);
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
  if (allowed) return { ok: true, userId: user.id, level: 'owner', tenant, db };

  if (options.allowTeamAdmins) {
    const { data: membership } = await db
      .from('crm_tenant_members')
      .select('role')
      .eq('tenant_id', tenant.id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (membership?.role === 'admin') {
      return { ok: true, userId: user.id, level: 'admin', tenant, db };
    }
  }

  return problem('You are not allowed to manage this tenant', 403);
}
