import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  interpretEvent,
  verifyWebhookSignature,
  type RazorpayEvent,
} from '@/lib/billing/razorpay';

/**
 *   POST /api/webhooks/razorpay
 *
 * Razorpay subscription events. The raw body is verified against
 * X-Razorpay-Signature before anything is parsed, and each X-Razorpay-Event-Id
 * is processed once (crm_billing_events): retries get a 200 and no effect.
 * If processing fails the event row is removed and a 500 makes Razorpay retry.
 */

const UNIQUE_VIOLATION = '23505';

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-razorpay-signature');
  if (
    !verifyWebhookSignature(
      rawBody,
      signature,
      process.env.RAZORPAY_WEBHOOK_SECRET
    )
  ) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const eventId = request.headers.get('x-razorpay-event-id');
  if (!eventId) {
    return NextResponse.json({ error: 'Missing event id' }, { status: 400 });
  }

  let event: RazorpayEvent;
  try {
    event = JSON.parse(rawBody) as RazorpayEvent;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { error: claimError } = await db
    .from('crm_billing_events')
    .insert({ event_id: eventId, event_type: event.event, payload: event });
  if (claimError) {
    if (claimError.code === UNIQUE_VIOLATION) {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    console.error('[razorpay] could not record event:', claimError.message);
    return NextResponse.json({ error: 'Could not record event' }, { status: 500 });
  }

  try {
    const effect = interpretEvent(event);
    if (effect?.tenantId && effect.subscriptionId) {
      // Match on the subscription id stored at checkout so events from an
      // older, replaced subscription cannot touch the current one.
      const { data: updated, error } = await db
        .from('crm_tenants')
        .update(effect.update)
        .eq('id', effect.tenantId)
        .eq('razorpay_subscription_id', effect.subscriptionId)
        .select('id');
      if (error) throw new Error(error.message);

      if (updated?.length && effect.invoice) {
        const { error: invoiceError } = await db.from('crm_invoices').upsert(
          {
            ...effect.invoice,
            tenant_id: effect.tenantId,
            plan: effect.update.plan ?? null,
            billing_interval: effect.update.billing_interval ?? null,
            status: 'paid',
          },
          { onConflict: 'razorpay_payment_id', ignoreDuplicates: true }
        );
        if (invoiceError) throw new Error(invoiceError.message);
      }
      if (!updated?.length) {
        console.warn('[razorpay] event matched no tenant:', event.event);
      }
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[razorpay] processing failed:', error);
    await db.from('crm_billing_events').delete().eq('event_id', eventId);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}
