import { NextRequest, NextResponse } from 'next/server';
import { authorizeTenantAccess, problem } from '@/lib/tenants/authorize-tenant';
import { MAX_CSAT_MESSAGE_LENGTH } from '@/lib/csat/csat';
import { normalizeAlertNumber } from '@/lib/handoff-alert/handoff-alert';

/**
 * CSAT survey and handoff alert settings for one tenant.
 *
 *   GET /api/tenants/[slug]/engagement
 *   PUT /api/tenants/[slug]/engagement
 *       { csatEnabled, csatMessage, alertEmail, alertWhatsapp, alertNumber }
 *
 * Allowed for the tenant's owner, platform admins and team admins.
 */
type Context = { params: Promise<{ slug: string }> };

interface Row {
  csat_enabled: boolean | null;
  csat_message: string | null;
  handoff_alert_email: boolean | null;
  handoff_alert_whatsapp: boolean | null;
  handoff_alert_number: string | null;
}

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { slug } = await context.params;
    const auth = await authorizeTenantAccess(slug, { allowTeamAdmins: true });
    if (!auth.ok) return auth.response;

    const { data, error } = await auth.db
      .from('crm_tenants')
      .select(
        'csat_enabled, csat_message, handoff_alert_email, handoff_alert_whatsapp, handoff_alert_number'
      )
      .eq('id', auth.tenant.id)
      .maybeSingle();
    if (error) {
      console.error('[tenants/engagement] load failed:', error.message);
      return problem('Could not load settings. Has migration 044 been applied?', 500).response;
    }
    const row = (data ?? null) as Row | null;
    return NextResponse.json({
      csatEnabled: row?.csat_enabled === true,
      csatMessage: row?.csat_message ?? '',
      alertEmail: row?.handoff_alert_email === true,
      alertWhatsapp: row?.handoff_alert_whatsapp === true,
      alertNumber: row?.handoff_alert_number ?? '',
    });
  } catch (error) {
    console.error('[tenants/engagement] unexpected error:', error);
    return problem('Could not load settings', 500).response;
  }
}

export async function PUT(request: NextRequest, context: Context) {
  try {
    const { slug } = await context.params;
    const auth = await authorizeTenantAccess(slug, { allowTeamAdmins: true });
    if (!auth.ok) return auth.response;

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    for (const key of ['csatEnabled', 'alertEmail', 'alertWhatsapp'] as const) {
      if (typeof body[key] !== 'boolean') {
        return problem(`${key} must be true or false`, 400).response;
      }
    }
    const csatMessage = typeof body.csatMessage === 'string' ? body.csatMessage.trim() : '';
    if (csatMessage.length > MAX_CSAT_MESSAGE_LENGTH) {
      return problem(`Keep the survey message under ${MAX_CSAT_MESSAGE_LENGTH} characters`, 400).response;
    }
    const alertNumberRaw = typeof body.alertNumber === 'string' ? body.alertNumber.trim() : '';
    if (body.alertWhatsapp === true && !normalizeAlertNumber(alertNumberRaw)) {
      return problem('Enter the WhatsApp number to alert, with country code', 400).response;
    }
    if (alertNumberRaw.length > 32) {
      return problem('That number is too long', 400).response;
    }

    const { error } = await auth.db
      .from('crm_tenants')
      .update({
        csat_enabled: body.csatEnabled,
        csat_message: csatMessage || null,
        handoff_alert_email: body.alertEmail,
        handoff_alert_whatsapp: body.alertWhatsapp,
        handoff_alert_number: alertNumberRaw || null,
      })
      .eq('id', auth.tenant.id);
    if (error) {
      console.error('[tenants/engagement] save failed:', error.message);
      return problem('Could not save settings', 500).response;
    }
    return NextResponse.json({
      csatEnabled: body.csatEnabled,
      csatMessage,
      alertEmail: body.alertEmail,
      alertWhatsapp: body.alertWhatsapp,
      alertNumber: alertNumberRaw,
    });
  } catch (error) {
    console.error('[tenants/engagement] unexpected error:', error);
    return problem('Could not save settings', 500).response;
  }
}
