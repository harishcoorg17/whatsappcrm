import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { authenticateApiKey } from '@/lib/integrations/api-key';
import { executeEnquiryDeal, parseEnquiryBody } from '@/lib/integrations/enquiry-deal';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

/**
 * POST /api/integrations/enquiries
 *
 * Server-to-server: the Amstago backend tells the CRM that a traveller asked
 * for a quote. The CRM adds the traveller as a contact and a deal in the
 * "Quote requests" pipeline (created on first use). Authenticated with a
 * per-tenant API key in `Authorization: Bearer amst_live_…`; the tenant comes
 * from the key, never from the request body.
 *
 *   { "reference": "e1234567-aaaa-bbbb-cccc-ddddeeeeffff",   // your enquiry id; repeats are safe
 *     "name": "Asha Rao",
 *     "phone": "919876543210",
 *     "email": "asha@example.com",                           // optional
 *     "tour_title": "The Perfect 6-Day Kerala Itinerary",
 *     "adults": 2,
 *     "children": [{ "age": 7 }, { "age": 3 }],              // optional
 *     "travel_date": "2026-12-05",                           // optional, YYYY-MM-DD
 *     "message": "...",                                      // optional
 *     "starting_price": 25000,                               // optional, per person
 *     "source": "tour_page",                                 // optional
 *     "pipeline_name": "Quote requests",                     // optional
 *     "stage_name": "New" }                                  // optional
 *
 * A repeated `reference` returns `status: "duplicate"` with the existing deal
 * and creates nothing, so the caller can retry safely.
 */

function error(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

export async function POST(request: Request) {
  try {
    const db = supabaseAdmin();

    const auth = await authenticateApiKey(db, request.headers.get('authorization'));
    if (!auth) {
      return error('unauthorized', 'Invalid or missing API key.', 401);
    }

    const limit = checkRateLimit(`integration-enquiry:${auth.keyId}`, RATE_LIMITS.integrationSend);
    if (!limit.success) return rateLimitResponse(limit);

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return error('invalid_json', 'Request body must be valid JSON.', 400);
    }

    const parsed = parseEnquiryBody(raw);
    if (!parsed.ok) return error('invalid_request', parsed.error, 400);

    const result = await executeEnquiryDeal({ db, auth, input: parsed.value });
    if (!result.ok) return error(result.code, result.message, result.httpStatus);

    return NextResponse.json({
      ok: true,
      status: result.status,
      deal_id: result.dealId,
      contact_id: result.contactId,
      pipeline_id: result.pipelineId,
    });
  } catch (err) {
    console.error('[integrations/enquiries] unexpected error:', err);
    return error('internal_error', 'Could not process the request.', 500);
  }
}
