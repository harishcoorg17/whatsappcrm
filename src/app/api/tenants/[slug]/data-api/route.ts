import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { normalizeDataApiUrl } from '@/lib/flows/data-api-url';
import { encrypt } from '@/lib/whatsapp/encryption';
import { canManageTenant } from '@/lib/whatsapp/embedded-signup';

// Visible characters only: the key is sent as an HTTP header, so a space or
// newline in it could be used to smuggle extra headers.
const API_KEY_PATTERN = /^[\x21-\x7E]{8,256}$/;
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

/**
 * PUT /api/tenants/[slug]/data-api  { url: string }
 *
 * Sets (or clears, with an empty url) the tenant's backend API base, which
 * flows reach through `{{api}}/…` in the "Fetch live data" node. Allowed for
 * the tenant's owner and platform admins. Only the validated, normalised
 * address is stored; the server re-checks it on every use.
 */
export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await context.params;

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const limit = checkRateLimit(
      `tenant-data-api:${user.id}`,
      RATE_LIMITS.tenantSelf
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      url?: unknown;
      api_key?: unknown;
      clear_api_key?: unknown;
    } | null;
    if (!body || typeof body.url !== 'string') {
      return NextResponse.json(
        { error: 'url (string) is required' },
        { status: 400 }
      );
    }

    const db = supabaseAdmin();
    const { data: tenant, error: tenantError } = await db
      .from('crm_tenants')
      .select('id, owner_user_id, data_api_config')
      .eq('slug', slug)
      .maybeSingle();
    if (tenantError) {
      console.error('[tenants/data-api] lookup failed:', tenantError.message);
      return NextResponse.json(
        { error: 'Could not load tenant' },
        { status: 500 }
      );
    }
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

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
    if (!allowed) {
      return NextResponse.json(
        { error: 'You are not allowed to manage this tenant' },
        { status: 403 }
      );
    }

    let dataApiUrl: string | null = null;
    if (body.url.trim() !== '') {
      const result = normalizeDataApiUrl(body.url);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      dataApiUrl = result.url;
    }

    // The integration key lives, encrypted, next to the address it belongs to.
    const apiKeyInput =
      typeof body.api_key === 'string' ? body.api_key.trim() : '';
    if (apiKeyInput && !API_KEY_PATTERN.test(apiKeyInput)) {
      return NextResponse.json(
        { error: 'The key must be 8–256 visible characters with no spaces.' },
        { status: 400 }
      );
    }
    if (apiKeyInput && dataApiUrl === null) {
      return NextResponse.json(
        { error: 'Set the API address together with the key.' },
        { status: 400 }
      );
    }

    const existingConfig = (tenant.data_api_config ?? {}) as Record<
      string,
      unknown
    >;
    let hasApiKey =
      typeof existingConfig.api_key_enc === 'string' &&
      existingConfig.api_key_enc !== '';
    let nextConfig: Record<string, unknown> | null = null;
    if (apiKeyInput) {
      nextConfig = {
        ...existingConfig,
        api_key_enc: encrypt(apiKeyInput),
        api_key_set_at: new Date().toISOString(),
      };
      hasApiKey = true;
    } else if (
      hasApiKey &&
      (body.clear_api_key === true || dataApiUrl === null)
    ) {
      // Removing the address, or asking to, also removes the key.
      const {
        api_key_enc: _removedKey,
        api_key_set_at: _removedAt,
        ...rest
      } = existingConfig;
      void _removedKey;
      void _removedAt;
      nextConfig = rest;
      hasApiKey = false;
    }

    const update: Record<string, unknown> = { data_api_url: dataApiUrl };
    if (nextConfig !== null) update.data_api_config = nextConfig;

    const { error: updateError } = await db
      .from('crm_tenants')
      .update(update)
      .eq('id', tenant.id);
    if (updateError) {
      console.error('[tenants/data-api] update failed:', updateError.message);
      return NextResponse.json(
        { error: 'Could not save the API address' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data_api_url: dataApiUrl,
      has_api_key: hasApiKey,
    });
  } catch (error) {
    console.error('[tenants/data-api] unexpected error:', error);
    return NextResponse.json(
      { error: 'Could not save the API address' },
      { status: 500 }
    );
  }
}
