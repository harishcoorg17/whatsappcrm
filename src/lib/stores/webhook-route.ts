import { NextResponse } from 'next/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { createStoreDeps } from './deps';
import type { StorePlatform } from './events';
import { handleStoreWebhook } from './handle-webhook';

/** Per store URL: a busy shop's order spike is fine, a flood is not. */
const STORE_WEBHOOK_LIMIT = { limit: 600, windowMs: 60_000 };

/** Shared POST handler for /api/integrations/{shopify,woocommerce}/[publicId]. */
export async function handleStoreWebhookRequest(
  request: Request,
  platform: StorePlatform,
  publicId: string
): Promise<NextResponse> {
  try {
    const limit = checkRateLimit(`store-webhook:${publicId}`, STORE_WEBHOOK_LIMIT);
    if (!limit.success) return rateLimitResponse(limit);

    // The signature covers the raw bytes, so read text, never request.json().
    const rawBody = await request.text();
    const result = await handleStoreWebhook(
      {
        platform,
        publicId,
        rawBody,
        getHeader: (name) => request.headers.get(name),
      },
      createStoreDeps()
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error(`[integrations/${platform}] unexpected error:`, err);
    // 500 makes the store retry, which is safe: events are idempotent.
    return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500 });
  }
}
