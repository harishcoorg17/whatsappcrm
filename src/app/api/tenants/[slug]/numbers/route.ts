import { NextRequest, NextResponse } from 'next/server';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { authorizeTenantAccess, problem } from '@/lib/tenants/authorize-tenant';
import { decrypt, encrypt } from '@/lib/whatsapp/encryption';
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api';

/**
 * A tenant's WhatsApp numbers.
 *
 *   GET  /api/tenants/[slug]/numbers   list numbers (never tokens)
 *   POST /api/tenants/[slug]/numbers   add { phoneNumberId, wabaId?,
 *                                      accessToken?, label? }
 *
 * Allowed for the tenant's owner and platform admins. A number added without
 * its own token shares the tenant's token. The number is checked against Meta
 * before it is saved so a typo cannot silently break routing.
 */

type Context = { params: Promise<{ slug: string }> };

const MAX_NUMBERS_PER_TENANT = 20;
const MAX_LABEL_LENGTH = 60;
const PHONE_NUMBER_ID_PATTERN = /^\d{5,25}$/;
const UNIQUE_VIOLATION = '23505';
const COLUMNS =
  'id, phone_number_id, waba_id, label, display_phone_number, is_primary, status, created_at, access_token_enc';

interface NumberRow {
  id: string;
  phone_number_id: string;
  waba_id: string | null;
  label: string | null;
  display_phone_number: string | null;
  is_primary: boolean;
  status: 'active' | 'disabled';
  created_at: string;
  access_token_enc: string | null;
}

/** Row shape returned to the browser: the token itself never leaves the server. */
function toPublic({ access_token_enc, ...rest }: NumberRow) {
  return { ...rest, has_own_token: Boolean(access_token_enc) };
}

function readString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { slug } = await context.params;
    const auth = await authorizeTenantAccess(slug);
    if (!auth.ok) return auth.response;

    const { data, error } = await auth.db
      .from('crm_tenant_numbers')
      .select(COLUMNS)
      .eq('tenant_id', auth.tenant.id)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true });
    if (error) {
      console.error('[tenants/numbers] list failed:', error.message);
      return NextResponse.json(
        { error: 'Could not list numbers' },
        { status: 500 }
      );
    }
    return NextResponse.json({
      numbers: ((data ?? []) as NumberRow[]).map(toPublic),
    });
  } catch (error) {
    console.error('[tenants/numbers] unexpected error:', error);
    return NextResponse.json(
      { error: 'Could not list numbers' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const { slug } = await context.params;
    const auth = await authorizeTenantAccess(slug);
    if (!auth.ok) return auth.response;

    const limit = checkRateLimit(
      `tenant-numbers:${auth.userId}`,
      RATE_LIMITS.tenantSelf
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const phoneNumberId = readString(body.phoneNumberId, 25);
    if (!phoneNumberId || !PHONE_NUMBER_ID_PATTERN.test(phoneNumberId)) {
      return problem('Enter the Phone Number ID from Meta (digits only)', 400)
        .response;
    }
    const wabaId = readString(body.wabaId, 25);
    const ownToken = readString(body.accessToken, 1000);
    const label = readString(body.label, MAX_LABEL_LENGTH);

    // Verify against Meta with the number's own token, else the tenant's.
    let verifyToken: string;
    try {
      const tokenEnc = ownToken ? null : auth.tenant.access_token_enc;
      if (!ownToken && !tokenEnc) {
        return problem(
          'Add an access token, or connect the tenant first so numbers can share its token',
          400
        ).response;
      }
      verifyToken = ownToken ?? decrypt(tokenEnc as string);
    } catch {
      return problem('Could not read the tenant access token', 500).response;
    }

    let phoneInfo;
    try {
      phoneInfo = await verifyPhoneNumber({
        phoneNumberId,
        accessToken: verifyToken,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Meta rejected it';
      return problem(`Meta could not verify this number: ${message}`, 400)
        .response;
    }

    // A number belongs to exactly one tenant: inbound routing depends on it.
    const [{ data: existingNumber }, { data: existingTenant }] =
      await Promise.all([
        auth.db
          .from('crm_tenant_numbers')
          .select('tenant_id')
          .eq('phone_number_id', phoneNumberId)
          .maybeSingle(),
        auth.db
          .from('crm_tenants')
          .select('id')
          .eq('phone_number_id', phoneNumberId)
          .maybeSingle(),
      ]);
    const ownerOfNumber =
      existingNumber?.tenant_id ?? existingTenant?.id ?? null;
    if (ownerOfNumber) {
      return problem(
        ownerOfNumber === auth.tenant.id
          ? 'This number is already added to this tenant'
          : 'This number is already connected to another tenant',
        409
      ).response;
    }

    const { count } = await auth.db
      .from('crm_tenant_numbers')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', auth.tenant.id);
    if ((count ?? 0) >= MAX_NUMBERS_PER_TENANT) {
      return problem(
        `A tenant can have at most ${MAX_NUMBERS_PER_TENANT} numbers`,
        400
      ).response;
    }

    const ownTokenEnc = ownToken ? encrypt(ownToken) : null;
    const displayName = label ?? phoneInfo.verified_name ?? null;
    const isFirst = !auth.tenant.phone_number_id;

    if (isFirst) {
      // The tenant's first number is its primary: write it to crm_tenants, and
      // the sync trigger creates the matching crm_tenant_numbers row.
      const { error: tenantError } = await auth.db
        .from('crm_tenants')
        .update({
          phone_number_id: phoneNumberId,
          waba_id: wabaId ?? auth.tenant.waba_id,
          access_token_enc: ownTokenEnc ?? auth.tenant.access_token_enc,
        })
        .eq('id', auth.tenant.id);
      if (tenantError) {
        console.error(
          '[tenants/numbers] primary save failed:',
          tenantError.message
        );
        return problem('Could not save the number', 500).response;
      }
    }

    const fields = {
      label: displayName,
      display_phone_number: phoneInfo.display_phone_number ?? null,
    };
    const { data: saved, error: saveError } = isFirst
      ? await auth.db
          .from('crm_tenant_numbers')
          .update(fields)
          .eq('tenant_id', auth.tenant.id)
          .eq('phone_number_id', phoneNumberId)
          .select(COLUMNS)
          .maybeSingle()
      : await auth.db
          .from('crm_tenant_numbers')
          .insert({
            tenant_id: auth.tenant.id,
            phone_number_id: phoneNumberId,
            waba_id: wabaId ?? auth.tenant.waba_id,
            access_token_enc: ownTokenEnc,
            is_primary: false,
            status: 'active',
            ...fields,
          })
          .select(COLUMNS)
          .single();

    if (saveError || !saved) {
      console.error('[tenants/numbers] save failed:', saveError?.message);
      if (saveError?.code === UNIQUE_VIOLATION) {
        return problem('This number is already connected', 409).response;
      }
      return problem('Could not save the number', 500).response;
    }

    return NextResponse.json(
      { number: toPublic(saved as NumberRow) },
      { status: 201 }
    );
  } catch (error) {
    console.error('[tenants/numbers] unexpected error:', error);
    return NextResponse.json(
      { error: 'Could not add the number' },
      { status: 500 }
    );
  }
}
