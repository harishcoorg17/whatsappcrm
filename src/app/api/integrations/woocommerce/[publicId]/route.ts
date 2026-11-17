import { handleStoreWebhookRequest } from '@/lib/stores/webhook-route';

/** POST /api/integrations/woocommerce/[publicId] — signed woocommerce webhooks. */
export async function POST(
  request: Request,
  context: { params: Promise<{ publicId: string }> }
) {
  const { publicId } = await context.params;
  return handleStoreWebhookRequest(request, 'woocommerce', publicId);
}
