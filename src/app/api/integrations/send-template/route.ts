import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { authenticateApiKey } from '@/lib/integrations/api-key';
import { recordOutboundTemplate } from '@/lib/integrations/record-outbound';
import {
  executeSendTemplate,
  parseSendTemplateBody,
} from '@/lib/integrations/send-template';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { loadWhatsAppCredentials } from '@/lib/whatsapp/credentials';
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api';

/**
 * POST /api/integrations/send-template
 *
 * Server-to-server: another system (the Amstago backend) asks the CRM to send
 * an APPROVED WhatsApp template. Authenticated with a per-tenant API key in
 * `Authorization: Bearer amst_live_…`; the tenant, and so the WhatsApp number
 * and the templates, come from the key, never from the request body.
 *
 *   { "to": "+919876543210",
 *     "template_name": "tour_purchase_confirmation",
 *     "language": "en_US",                       // optional, default en_US
 *     "reference": "booking-123:confirmation",   // your id; repeats are safe
 *     "params": ["Asha", "Kerala Hills", ...],   // body {{1}}, {{2}}, …
 *     "header_text": "...",                      // optional
 *     "button_params": { "1": "..." },           // optional URL-button suffix
 *     "contact_name": "Asha Rao" }               // optional
 *
 * A repeated `reference` returns `status: "duplicate"` and does NOT message
 * the customer again, so the caller can retry safely.
 */

function error(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

export async function POST(request: Request) {
  try {
    const db = supabaseAdmin();

    const auth = await authenticateApiKey(
      db,
      request.headers.get('authorization')
    );
    if (!auth) {
      return error('unauthorized', 'Invalid or missing API key.', 401);
    }

    const limit = checkRateLimit(
      `integration-send:${auth.keyId}`,
      RATE_LIMITS.integrationSend
    );
    if (!limit.success) return rateLimitResponse(limit);

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return error('invalid_json', 'Request body must be valid JSON.', 400);
    }

    const parsed = parseSendTemplateBody(raw);
    if (!parsed.ok) return error('invalid_request', parsed.error, 400);

    const result = await executeSendTemplate({
      db,
      auth,
      input: parsed.value,
      deps: {
        sendTemplate: sendTemplateMessage,
        loadCredentials: loadWhatsAppCredentials,
        record: recordOutboundTemplate,
      },
    });

    if (!result.ok) {
      return error(result.code, result.message, result.httpStatus);
    }
    return NextResponse.json({
      ok: true,
      status: result.status,
      message_id: result.messageId,
      conversation_id: result.conversationId,
    });
  } catch (err) {
    console.error('[integrations/send-template] unexpected error:', err);
    return error('internal_error', 'Could not process the request.', 500);
  }
}
