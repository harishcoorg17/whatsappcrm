import { NextRequest, NextResponse } from 'next/server';
import { authorizeTenantAccess, problem } from '@/lib/tenants/authorize-tenant';

/**
 * One WhatsApp number of a tenant.
 *
 *   PATCH  /api/tenants/[slug]/numbers/[id]   { label?, status?, isPrimary? }
 *   DELETE /api/tenants/[slug]/numbers/[id]
 *
 * The primary number is mirrored on crm_tenants (older screens and code read
 * it there), and a database trigger keeps crm_tenant_numbers in step, so
 * making a number primary is a single update of the tenant row. The primary
 * cannot be disabled or deleted: promote another number first.
 */

type Context = { params: Promise<{ slug: string; id: string }> };

const MAX_LABEL_LENGTH = 60;
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

function toPublic({ access_token_enc, ...rest }: NumberRow) {
  return { ...rest, has_own_token: Boolean(access_token_enc) };
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { slug, id } = await context.params;
    const auth = await authorizeTenantAccess(slug);
    if (!auth.ok) return auth.response;

    const { data: current } = await auth.db
      .from('crm_tenant_numbers')
      .select(COLUMNS)
      .eq('id', id)
      .eq('tenant_id', auth.tenant.id)
      .maybeSingle();
    if (!current) return problem('Number not found', 404).response;
    const row = current as NumberRow;

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const updates: Record<string, unknown> = {};

    if (body.label !== undefined) {
      const label = typeof body.label === 'string' ? body.label.trim() : '';
      if (label.length === 0 || label.length > MAX_LABEL_LENGTH) {
        return problem(`Label must be 1-${MAX_LABEL_LENGTH} characters`, 400)
          .response;
      }
      updates.label = label;
    }

    if (body.status !== undefined) {
      if (body.status !== 'active' && body.status !== 'disabled') {
        return problem('Status must be active or disabled', 400).response;
      }
      if (body.status === 'disabled' && row.is_primary) {
        return problem(
          'Make another number primary before disabling this one',
          400
        ).response;
      }
      updates.status = body.status;
    }

    if (body.isPrimary === false) {
      return problem('Make another number primary instead', 400).response;
    }
    const makePrimary = body.isPrimary === true && !row.is_primary;
    if (makePrimary && (updates.status ?? row.status) !== 'active') {
      return problem('Only an active number can be primary', 400).response;
    }

    if (Object.keys(updates).length > 0) {
      const { error } = await auth.db
        .from('crm_tenant_numbers')
        .update(updates)
        .eq('id', row.id);
      if (error) {
        console.error('[tenants/numbers] update failed:', error.message);
        return problem('Could not update the number', 500).response;
      }
    }

    if (makePrimary) {
      // The sync trigger demotes the old primary and promotes this number.
      const { error } = await auth.db
        .from('crm_tenants')
        .update({
          phone_number_id: row.phone_number_id,
          waba_id: row.waba_id ?? auth.tenant.waba_id,
          access_token_enc:
            row.access_token_enc ?? auth.tenant.access_token_enc,
        })
        .eq('id', auth.tenant.id);
      if (error) {
        console.error('[tenants/numbers] make primary failed:', error.message);
        return problem('Could not make this number primary', 500).response;
      }
    }

    const { data: updated } = await auth.db
      .from('crm_tenant_numbers')
      .select(COLUMNS)
      .eq('id', row.id)
      .maybeSingle();
    return NextResponse.json({
      number: updated ? toPublic(updated as NumberRow) : null,
    });
  } catch (error) {
    console.error('[tenants/numbers] unexpected error:', error);
    return NextResponse.json(
      { error: 'Could not update the number' },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, context: Context) {
  try {
    const { slug, id } = await context.params;
    const auth = await authorizeTenantAccess(slug);
    if (!auth.ok) return auth.response;

    const { data: current } = await auth.db
      .from('crm_tenant_numbers')
      .select('id, is_primary')
      .eq('id', id)
      .eq('tenant_id', auth.tenant.id)
      .maybeSingle();
    if (!current) return problem('Number not found', 404).response;
    if (current.is_primary) {
      return problem(
        'Make another number primary before removing this one',
        400
      ).response;
    }

    const { error } = await auth.db
      .from('crm_tenant_numbers')
      .delete()
      .eq('id', current.id);
    if (error) {
      console.error('[tenants/numbers] delete failed:', error.message);
      return problem('Could not remove the number', 500).response;
    }
    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error('[tenants/numbers] unexpected error:', error);
    return NextResponse.json(
      { error: 'Could not remove the number' },
      { status: 500 }
    );
  }
}
