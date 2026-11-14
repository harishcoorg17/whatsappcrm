import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { createClient } from '@/lib/supabase/server';

/**
 * DELETE /api/tenants/[slug]
 *
 * Permanently deletes a tenant. Every tenant-scoped table references
 * crm_tenants with ON DELETE CASCADE, so this also removes the tenant's
 * contacts, conversations, messages, pipelines, broadcasts, automations and
 * integration keys. It cannot be undone.
 *
 * Guards:
 *   - signed-in platform admins only (not tenant owners)
 *   - the body must repeat the slug as `confirmSlug`, so a stray request or a
 *     wrong row cannot delete a tenant
 */

type Context = { params: Promise<{ slug: string }> };

const FOREIGN_KEY_VIOLATION = '23503';

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function readConfirmSlug(request: NextRequest): Promise<string | null> {
  try {
    const body = (await request.json()) as { confirmSlug?: unknown };
    return typeof body.confirmSlug === 'string' ? body.confirmSlug : null;
  } catch {
    return null;
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const { slug } = await context.params;

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) return fail('Unauthorized', 401);

    const limit = checkRateLimit(
      `tenant-delete:${user.id}`,
      RATE_LIMITS.tenantSelf
    );
    if (!limit.success) return rateLimitResponse(limit);

    const db = supabaseAdmin();

    const { data: admin } = await db
      .from('crm_platform_admins')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!admin) return fail('Only platform admins can delete a tenant', 403);

    const confirmSlug = await readConfirmSlug(request);
    if (confirmSlug !== slug) {
      return fail('Type the tenant slug to confirm deletion', 400);
    }

    const { data: tenant, error: lookupError } = await db
      .from('crm_tenants')
      .select('id, name')
      .eq('slug', slug)
      .maybeSingle();
    if (lookupError) {
      console.error('[tenants/delete] lookup failed:', lookupError.message);
      return fail('Could not load tenant', 500);
    }
    if (!tenant) return fail('Tenant not found', 404);

    const { error: deleteError } = await db
      .from('crm_tenants')
      .delete()
      .eq('id', tenant.id);
    if (deleteError) {
      console.error('[tenants/delete] delete failed:', deleteError.message);
      if (deleteError.code === FOREIGN_KEY_VIOLATION) {
        return fail(
          'This tenant still has linked records that block deletion',
          409
        );
      }
      return fail('Could not delete tenant', 500);
    }

    console.info(
      `[tenants/delete] ${user.id} deleted tenant ${slug} (${tenant.id})`
    );
    return NextResponse.json({ deleted: true, slug });
  } catch (error) {
    console.error('[tenants/delete] unexpected error:', error);
    return fail('Could not delete tenant', 500);
  }
}
