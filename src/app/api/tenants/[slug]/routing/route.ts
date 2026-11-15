import { NextRequest, NextResponse } from 'next/server';
import {
  defaultBusinessHours,
  MAX_AWAY_MESSAGE_LENGTH,
  parseBusinessHours,
} from '@/lib/whatsapp/business-hours';
import { authorizeTenantAccess, problem } from '@/lib/tenants/authorize-tenant';

/**
 * A tenant's business hours and routing.
 *
 *   GET /api/tenants/[slug]/routing
 *   PUT /api/tenants/[slug]/routing   { businessHours, awayMessage, autoAssign }
 *
 * Allowed for the tenant's owner, platform admins and team admins. The
 * away message is sent outside business hours (once per chat per 12 hours),
 * and auto-assign gives new chats to the least-busy team member.
 */

type Context = { params: Promise<{ slug: string }> };

interface RoutingRow {
  business_hours: unknown;
  away_message: string | null;
  auto_assign: boolean | null;
}

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { slug } = await context.params;
    const auth = await authorizeTenantAccess(slug, { allowTeamAdmins: true });
    if (!auth.ok) return auth.response;

    const { data, error } = await auth.db
      .from('crm_tenants')
      .select('business_hours, away_message, auto_assign')
      .eq('id', auth.tenant.id)
      .maybeSingle();
    if (error) {
      console.error('[tenants/routing] load failed:', error.message);
      return problem(
        'Could not load hours and routing. Has the latest migration been applied?',
        500
      ).response;
    }

    const row = (data ?? null) as RoutingRow | null;
    const parsed = parseBusinessHours(row?.business_hours);
    return NextResponse.json({
      businessHours: parsed.ok ? parsed.hours : defaultBusinessHours(),
      awayMessage: row?.away_message ?? '',
      autoAssign: row?.auto_assign === true,
    });
  } catch (error) {
    console.error('[tenants/routing] unexpected error:', error);
    return problem('Could not load hours and routing', 500).response;
  }
}

export async function PUT(request: NextRequest, context: Context) {
  try {
    const { slug } = await context.params;
    const auth = await authorizeTenantAccess(slug, { allowTeamAdmins: true });
    if (!auth.ok) return auth.response;

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    const parsed = parseBusinessHours(body.businessHours);
    if (!parsed.ok) return problem(parsed.error, 400).response;

    const awayMessage =
      typeof body.awayMessage === 'string' ? body.awayMessage.trim() : '';
    if (awayMessage.length > MAX_AWAY_MESSAGE_LENGTH) {
      return problem(
        `Keep the away message under ${MAX_AWAY_MESSAGE_LENGTH} characters`,
        400
      ).response;
    }
    if (parsed.hours.enabled && !awayMessage) {
      return problem(
        'Write the away message customers get outside your hours',
        400
      ).response;
    }
    if (typeof body.autoAssign !== 'boolean') {
      return problem('autoAssign must be true or false', 400).response;
    }

    const { error } = await auth.db
      .from('crm_tenants')
      .update({
        business_hours: parsed.hours,
        away_message: awayMessage || null,
        auto_assign: body.autoAssign,
      })
      .eq('id', auth.tenant.id);
    if (error) {
      console.error('[tenants/routing] save failed:', error.message);
      return problem('Could not save hours and routing', 500).response;
    }

    return NextResponse.json({
      businessHours: parsed.hours,
      awayMessage,
      autoAssign: body.autoAssign,
    });
  } catch (error) {
    console.error('[tenants/routing] unexpected error:', error);
    return problem('Could not save hours and routing', 500).response;
  }
}
