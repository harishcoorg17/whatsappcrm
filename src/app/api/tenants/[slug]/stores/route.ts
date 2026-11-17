import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { authorizeTenantAccess, problem } from '@/lib/tenants/authorize-tenant';
import {
  MAX_STORES_PER_TENANT,
  parseConnectionInput,
} from '@/lib/stores/connection-input';
import { generatePublicId, generateStoreSecret } from '@/lib/stores/signature';
import { appOrigin } from '@/lib/stores/app-origin';
import { encrypt } from '@/lib/whatsapp/encryption';

/**
 * A tenant's connected Shopify / WooCommerce stores.
 *
 *   GET  /api/tenants/[slug]/stores   list (never secrets)
 *   POST /api/tenants/[slug]/stores   connect { platform, shopDomain, secret?,
 *                                     defaultCountryCode?, abandonedAfterMinutes? }
 *        WooCommerce: the generated secret is returned ONCE in the response.
 */

type Context = { params: Promise<{ slug: string }> };

const COLUMNS =
  'id, platform, shop_domain, public_id, default_country_code, abandoned_after_minutes, enabled, last_event_at, created_at';

interface Row {
  id: string;
  platform: 'shopify' | 'woocommerce';
  public_id: string;
  [key: string]: unknown;
}

function withUrl(request: NextRequest, row: Row) {
  return {
    ...row,
    webhook_url: `${appOrigin(request)}/api/integrations/${row.platform}/${row.public_id}`,
  };
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const { slug } = await context.params;
    const auth = await authorizeTenantAccess(slug, { allowTeamAdmins: true });
    if (!auth.ok) return auth.response;

    const { data, error } = await auth.db
      .from('crm_store_connections')
      .select(COLUMNS)
      .eq('tenant_id', auth.tenant.id)
      .order('created_at', { ascending: true });
    if (error) {
      console.error('[tenants/stores] list failed:', error.message);
      return problem('Could not load stores. Has migration 040 been applied?', 500).response;
    }
    return NextResponse.json({
      stores: ((data ?? []) as Row[]).map((r) => withUrl(request, r)),
    });
  } catch (error) {
    console.error('[tenants/stores] unexpected error:', error);
    return problem('Could not load stores', 500).response;
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const { slug } = await context.params;
    const auth = await authorizeTenantAccess(slug, { allowTeamAdmins: true });
    if (!auth.ok) return auth.response;

    const limit = checkRateLimit(`tenant-stores:${auth.userId}`, RATE_LIMITS.tenantSelf);
    if (!limit.success) return rateLimitResponse(limit);

    const parsed = parseConnectionInput(await request.json().catch(() => ({})));
    if (!parsed.ok) return problem(parsed.error, 400).response;
    const input = parsed.value;

    const { count } = await auth.db
      .from('crm_store_connections')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', auth.tenant.id);
    if ((count ?? 0) >= MAX_STORES_PER_TENANT) {
      return problem(`A workspace can connect at most ${MAX_STORES_PER_TENANT} stores`, 400).response;
    }

    const generated = input.platform === 'woocommerce' ? generateStoreSecret() : null;
    const secret = input.secret ?? generated!;
    const { data, error } = await auth.db
      .from('crm_store_connections')
      .insert({
        tenant_id: auth.tenant.id,
        platform: input.platform,
        shop_domain: input.shopDomain,
        public_id: generatePublicId(),
        secret_enc: encrypt(secret),
        default_country_code: input.defaultCountryCode,
        abandoned_after_minutes: input.abandonedAfterMinutes,
        created_by: auth.userId,
      })
      .select(COLUMNS)
      .single();
    if (error?.code === '23505') {
      return problem('That store is already connected', 409).response;
    }
    if (error || !data) {
      console.error('[tenants/stores] create failed:', error?.message);
      return problem('Could not connect the store', 500).response;
    }
    return NextResponse.json(
      { store: withUrl(request, data as Row), secret: generated },
      { status: 201 }
    );
  } catch (error) {
    console.error('[tenants/stores] unexpected error:', error);
    return problem('Could not connect the store', 500).response;
  }
}
