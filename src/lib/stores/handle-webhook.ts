import type { AutomationTriggerType } from '@/types';
import {
  parseStoreEvent,
  type ParsedStoreEvent,
  type StorePlatform,
  type StoreTrigger,
} from './events';
import { verifyStoreSignature } from './signature';

/**
 * Orchestrates one store webhook: verify the signature, map the event, record
 * it once (idempotent), then fire the matching automations. All I/O goes
 * through `StoreRepo` / `StoreDeps` so the flow is unit-testable.
 */

export interface StoreConnection {
  id: string;
  tenantId: string;
  ownerUserId: string;
  platform: StorePlatform;
  shopDomain: string;
  secretEnc: string;
  defaultCountryCode: string;
  abandonedAfterMinutes: number;
}

export type StoreEventStatus =
  | 'pending'
  | 'processing'
  | 'processed'
  | 'cancelled'
  | 'failed';

export interface StoredEventPayload {
  phone: string | null;
  name: string | null;
  vars: Record<string, string>;
}

export interface NewStoreEvent {
  connectionId: string;
  tenantId: string;
  dedupeKey: string;
  topic: string;
  trigger: StoreTrigger;
  checkoutToken: string | null;
  status: StoreEventStatus;
  fireAt: string | null;
  payload: StoredEventPayload;
  error?: string;
}

export interface DueStoreEvent {
  connection: StoreConnection;
  dedupeKey: string;
  trigger: StoreTrigger;
  payload: StoredEventPayload;
}

export interface StoreRepo {
  /** Enabled connection (and active tenant) for a webhook URL token, or null. */
  loadConnection(
    platform: StorePlatform,
    publicId: string
  ): Promise<StoreConnection | null>;
  /** Insert once per (connection, dedupeKey). False means it already existed. */
  claimEvent(event: NewStoreEvent): Promise<boolean>;
  /** Cancel not-yet-sent abandoned-cart events for a completed checkout. */
  cancelPendingCarts(connectionId: string, checkoutToken: string): Promise<void>;
  setEventStatus(
    connectionId: string,
    dedupeKey: string,
    status: StoreEventStatus,
    error?: string
  ): Promise<void>;
  touchConnection(connectionId: string): Promise<void>;
  findOrCreateContact(
    connection: StoreConnection,
    phone: string,
    name: string | null
  ): Promise<string>;
  /** Atomically move due pending carts to 'processing' and return them. */
  claimDueCarts(nowIso: string, limit: number): Promise<DueStoreEvent[]>;
}

export interface StoreDeps {
  repo: StoreRepo;
  decrypt: (enc: string) => string;
  runAutomations: (input: {
    userId: string;
    triggerType: AutomationTriggerType;
    contactId: string;
    context: { vars: Record<string, unknown> };
  }) => Promise<void>;
  now: () => Date;
}

export interface WebhookInput {
  platform: StorePlatform;
  publicId: string;
  rawBody: string;
  getHeader: (name: string) => string | null;
}

export interface WebhookOutput {
  status: number;
  body: Record<string, unknown>;
}

const HEADERS = {
  shopify: { signature: 'x-shopify-hmac-sha256', topic: 'x-shopify-topic' },
  woocommerce: { signature: 'x-wc-webhook-signature', topic: 'x-wc-webhook-topic' },
} as const;

const MS_PER_MINUTE = 60_000;
export const MAX_DUE_CARTS_PER_RUN = 50;

function reply(status: number, body: Record<string, unknown>): WebhookOutput {
  return { status, body };
}

export async function handleStoreWebhook(
  input: WebhookInput,
  deps: StoreDeps
): Promise<WebhookOutput> {
  const { repo } = deps;
  const connection = await repo.loadConnection(input.platform, input.publicId);
  // Same answer for "no such store" and "disabled" so URLs can't be probed.
  if (!connection) return reply(404, { ok: false, error: 'not_found' });

  const headers = HEADERS[input.platform];
  let secret: string;
  try {
    secret = deps.decrypt(connection.secretEnc);
  } catch {
    console.error('[stores] cannot decrypt secret for connection', connection.id);
    return reply(500, { ok: false, error: 'misconfigured' });
  }
  if (!verifyStoreSignature(input.rawBody, input.getHeader(headers.signature), secret)) {
    return reply(401, { ok: false, error: 'invalid_signature' });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(input.rawBody);
  } catch {
    // WooCommerce sends a non-JSON "ping" (webhook_id=…) when a webhook is saved.
    return reply(200, { ok: true, status: 'ignored', reason: 'not_json' });
  }

  const topic = input.getHeader(headers.topic) ?? '';
  const event = parseStoreEvent(input.platform, {
    topic,
    payload,
    shopDomain: connection.shopDomain,
    defaultCountryCode: connection.defaultCountryCode,
  });
  if (!event) return reply(200, { ok: true, status: 'ignored', reason: 'unsupported_topic' });

  await repo.touchConnection(connection.id);
  return ingestEvent(connection, event, deps);
}

async function ingestEvent(
  connection: StoreConnection,
  event: ParsedStoreEvent,
  deps: StoreDeps
): Promise<WebhookOutput> {
  const { repo } = deps;
  const stored: StoredEventPayload = {
    phone: event.phone,
    name: event.name,
    vars: event.vars,
  };
  const base = {
    connectionId: connection.id,
    tenantId: connection.tenantId,
    dedupeKey: event.dedupeKey,
    topic: event.topic,
    trigger: event.trigger,
    checkoutToken: event.checkoutToken,
    payload: stored,
  };

  if (!event.phone) {
    const fresh = await repo.claimEvent({
      ...base,
      status: 'failed',
      fireAt: null,
      error: 'no phone number on the order',
    });
    return reply(200, { ok: true, status: fresh ? 'no_phone' : 'duplicate' });
  }

  if (event.trigger === 'cart_abandoned') {
    const fireAt = new Date(
      deps.now().getTime() + connection.abandonedAfterMinutes * MS_PER_MINUTE
    ).toISOString();
    const fresh = await repo.claimEvent({ ...base, status: 'pending', fireAt });
    return reply(200, { ok: true, status: fresh ? 'queued' : 'duplicate' });
  }

  const fresh = await repo.claimEvent({ ...base, status: 'processing', fireAt: null });
  if (!fresh) return reply(200, { ok: true, status: 'duplicate' });

  if (event.trigger === 'order_placed' && event.checkoutToken) {
    await repo.cancelPendingCarts(connection.id, event.checkoutToken);
  }
  const result = await dispatch(connection, event.dedupeKey, event.trigger, stored, deps);
  return reply(200, { ok: true, status: result });
}

async function dispatch(
  connection: StoreConnection,
  dedupeKey: string,
  trigger: StoreTrigger,
  payload: StoredEventPayload,
  deps: StoreDeps
): Promise<'processed' | 'failed'> {
  const { repo } = deps;
  try {
    if (!payload.phone) throw new Error('no phone number on the order');
    const contactId = await repo.findOrCreateContact(
      connection,
      payload.phone,
      payload.name
    );
    await deps.runAutomations({
      userId: connection.ownerUserId,
      triggerType: trigger,
      contactId,
      context: { vars: payload.vars },
    });
    await repo.setEventStatus(connection.id, dedupeKey, 'processed');
    return 'processed';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[stores] dispatch failed:', connection.id, message);
    await repo.setEventStatus(connection.id, dedupeKey, 'failed', message.slice(0, 500));
    return 'failed';
  }
}

/** Cron: fire abandoned carts whose wait is over and that were not completed. */
export async function processDueAbandonedCarts(
  deps: StoreDeps
): Promise<{ processed: number; failed: number }> {
  const due = await deps.repo.claimDueCarts(
    deps.now().toISOString(),
    MAX_DUE_CARTS_PER_RUN
  );
  let processed = 0;
  let failed = 0;
  for (const item of due) {
    const result = await dispatch(
      item.connection,
      item.dedupeKey,
      item.trigger,
      item.payload,
      deps
    );
    if (result === 'processed') processed += 1;
    else failed += 1;
  }
  return { processed, failed };
}
