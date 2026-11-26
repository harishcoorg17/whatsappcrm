import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { authenticateApiKey } from '@/lib/integrations/api-key';
import {
  parseGroupRegistration,
  registerPendingGroup,
} from '@/lib/integrations/group-registry';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

/**
 * POST /api/integrations/groups
 *
 * Server-to-server: the Amstago backend registers a leader-created group trip
 * so it shows on the tenant's Groups page. The WhatsApp group is made by hand
 * later, so the row has no invite link yet. Authenticated with a per-tenant
 * API key; the tenant comes from the key.
 *
 *   { "reference": "<community trip id>",   // repeats are safe
 *     "name": "Kerala (Group – 2026-12-05)",
 *     "description": "...",                  // optional
 *     "capacity": 20,                        // optional
 *     "departure_date": "2026-12-05" }       // optional
 */

function error(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

export async function POST(request: Request) {
  try {
    const db = supabaseAdmin();

    const auth = await authenticateApiKey(db, request.headers.get('authorization'));
    if (!auth) return error('unauthorized', 'Invalid or missing API key.', 401);

    const limit = checkRateLimit(`integration-group:${auth.keyId}`, RATE_LIMITS.integrationSend);
    if (!limit.success) return rateLimitResponse(limit);

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return error('invalid_json', 'Request body must be valid JSON.', 400);
    }

    const parsed = parseGroupRegistration(raw);
    if (!parsed.ok) return error('invalid_request', parsed.error, 400);

    const result = await registerPendingGroup(db, auth.tenantId, parsed.value);
    if (!result.ok) return error('internal_error', result.message, 500);

    return NextResponse.json(
      { ok: true, status: result.status, group_id: result.groupId },
      { status: result.status === 'created' ? 201 : 200 }
    );
  } catch (err) {
    console.error('[integrations/groups] unexpected error:', err);
    return error('internal_error', 'Could not process the request.', 500);
  }
}
