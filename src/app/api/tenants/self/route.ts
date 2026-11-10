import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { buildTenantSlug, deriveTenantName } from '@/lib/tenants/slug';

const SLUG_SUFFIX_BYTES = 3;
const MAX_SLUG_ATTEMPTS = 3;
const UNIQUE_VIOLATION = '23505';

/**
 * POST /api/tenants/self
 *
 * Returns the signed-in user's own workspace, creating it on first call. Only
 * platform admins can insert into crm_tenants from the browser (RLS), so
 * self-serve signup goes through this route with the service role. The owner
 * is always the caller; nothing in the request body is trusted.
 */
export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const limit = checkRateLimit(
      `tenant-self:${user.id}`,
      RATE_LIMITS.tenantSelf
    );
    if (!limit.success) return rateLimitResponse(limit);

    const db = supabaseAdmin();

    const { data: existing, error: findError } = await db
      .from('crm_tenants')
      .select('slug')
      .eq('owner_user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (findError) {
      console.error('[tenants/self] lookup failed:', findError.message);
      return NextResponse.json(
        { error: 'Could not load your workspace' },
        { status: 500 }
      );
    }
    if (existing) {
      return NextResponse.json({ slug: existing.slug, created: false });
    }

    const name = deriveTenantName(user.user_metadata?.full_name, user.email);

    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
      const slug = buildTenantSlug(
        name,
        randomBytes(SLUG_SUFFIX_BYTES).toString('hex')
      );
      const { error: insertError } = await db.from('crm_tenants').insert({
        name,
        slug,
        plan: 'starter',
        status: 'pending',
        owner_user_id: user.id,
      });

      if (!insertError) {
        return NextResponse.json({ slug, created: true }, { status: 201 });
      }
      if (insertError.code !== UNIQUE_VIOLATION) {
        console.error('[tenants/self] insert failed:', insertError.message);
        break;
      }
    }

    return NextResponse.json(
      { error: 'Could not create your workspace' },
      { status: 500 }
    );
  } catch (error) {
    console.error('[tenants/self] unexpected error:', error);
    return NextResponse.json(
      { error: 'Could not create your workspace' },
      { status: 500 }
    );
  }
}
