import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  buildEnvelope,
  type WebhookEnvelope,
  type WebhookEventName,
} from './events';
import {
  buildSignatureHeader,
  DELIVERY_HEADER,
  EVENT_HEADER,
  SIGNATURE_HEADER,
} from './signing';
import { assertSafeWebhookUrl } from './url-safety';

/**
 * Sends signed webhook events to a tenant's endpoints.
 *
 *   - every attempt is logged (crm_webhook_deliveries, last 50 per endpoint);
 *   - network errors, 5xx, 408 and 429 are retried (3 attempts: now, +2s, +10s);
 *     other 4xx are the receiver saying no, so they are not retried;
 *   - redirects are never followed and the URL is re-checked before each
 *     attempt, so a tenant cannot aim us at an internal address;
 *   - after 10 failed deliveries in a row the endpoint is switched off.
 *
 * emitWebhookEvent() is fire-and-forget: webhooks must never slow down or
 * break the customer's message being processed.
 */

export const DELIVERY_TIMEOUT_MS = 5000;
export const RETRY_DELAYS_MS = [0, 2000, 10000] as const;
export const AUTO_DISABLE_AFTER_FAILURES = 10;
export const KEEP_DELIVERIES_PER_ENDPOINT = 50;
const USER_AGENT = 'ConverMesh-Webhooks/1.0';

export interface WebhookEndpoint {
  id: string;
  tenant_id: string;
  url: string;
  secret_enc: string;
  events: string[];
  consecutive_failures: number;
}

export interface DeliveryDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  decryptSecret?: (encrypted: string) => string;
  assertUrl?: typeof assertSafeWebhookUrl;
  nowSeconds?: () => number;
  /** Fewer attempts than the default 3, e.g. 1 for the Test button. */
  maxAttempts?: number;
}

export interface DeliveryResult {
  ok: boolean;
  status?: number;
  error?: string;
  attempts: number;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const isRetryable = (status: number) =>
  status >= 500 || status === 408 || status === 429;

async function recordAttempt(
  db: SupabaseClient,
  endpointId: string,
  eventType: string,
  attempt: number,
  outcome: { ok: boolean; status?: number; error?: string; durationMs: number }
) {
  const { error } = await db.from('crm_webhook_deliveries').insert({
    endpoint_id: endpointId,
    event_type: eventType,
    status: outcome.ok ? 'success' : 'failed',
    http_status: outcome.status ?? null,
    error: outcome.error ? outcome.error.slice(0, 500) : null,
    attempt,
    duration_ms: outcome.durationMs,
  });
  if (error) {
    console.warn('[webhooks] could not log delivery:', error.message);
  }
}

async function pruneDeliveries(db: SupabaseClient, endpointId: string) {
  const { data } = await db
    .from('crm_webhook_deliveries')
    .select('id')
    .eq('endpoint_id', endpointId)
    .order('created_at', { ascending: false })
    .range(KEEP_DELIVERIES_PER_ENDPOINT, KEEP_DELIVERIES_PER_ENDPOINT + 200);
  const stale = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  if (stale.length > 0) {
    await db.from('crm_webhook_deliveries').delete().in('id', stale);
  }
}

async function updateHealth(
  db: SupabaseClient,
  endpoint: WebhookEndpoint,
  succeeded: boolean
) {
  const nowIso = new Date().toISOString();
  if (succeeded) {
    await db
      .from('crm_webhook_endpoints')
      .update({
        consecutive_failures: 0,
        last_success_at: nowIso,
        disabled_reason: null,
      })
      .eq('id', endpoint.id);
    return;
  }
  const failures = endpoint.consecutive_failures + 1;
  const disable = failures >= AUTO_DISABLE_AFTER_FAILURES;
  await db
    .from('crm_webhook_endpoints')
    .update({
      consecutive_failures: failures,
      last_failure_at: nowIso,
      ...(disable
        ? {
            enabled: false,
            disabled_reason: `Turned off after ${failures} failed deliveries in a row`,
          }
        : {}),
    })
    .eq('id', endpoint.id);
}

/** Deliver one envelope to one endpoint, with retries. Never throws. */
export async function deliverToEndpoint(
  db: SupabaseClient,
  endpoint: WebhookEndpoint,
  envelope: WebhookEnvelope,
  deps: DeliveryDeps = {}
): Promise<DeliveryResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const assertUrl = deps.assertUrl ?? assertSafeWebhookUrl;
  const nowSeconds = deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000));

  let secret: string;
  try {
    secret = (deps.decryptSecret ?? decrypt)(endpoint.secret_enc);
  } catch {
    await recordAttempt(db, endpoint.id, envelope.type, 1, {
      ok: false,
      error: 'The signing secret could not be read',
      durationMs: 0,
    });
    await updateHealth(db, endpoint, false);
    return {
      ok: false,
      error: 'The signing secret could not be read',
      attempts: 1,
    };
  }

  const body = JSON.stringify(envelope);
  let last: DeliveryResult = { ok: false, attempts: 0 };

  const maxAttempts = Math.min(
    Math.max(1, deps.maxAttempts ?? RETRY_DELAYS_MS.length),
    RETRY_DELAYS_MS.length
  );

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (RETRY_DELAYS_MS[attempt - 1] > 0)
      await sleep(RETRY_DELAYS_MS[attempt - 1]);

    const started = Date.now();
    const safe = await assertUrl(endpoint.url);
    if (!safe.ok) {
      last = { ok: false, error: safe.error, attempts: attempt };
      await recordAttempt(db, endpoint.id, envelope.type, attempt, {
        ok: false,
        error: safe.error,
        durationMs: 0,
      });
      break; // an unsafe address will not become safe by retrying
    }

    try {
      const response = await fetchImpl(safe.url.toString(), {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
          [EVENT_HEADER]: envelope.type,
          [DELIVERY_HEADER]: envelope.id,
          [SIGNATURE_HEADER]: buildSignatureHeader(secret, body, nowSeconds()),
        },
        body,
      });
      const durationMs = Date.now() - started;
      const ok = response.status >= 200 && response.status < 300;
      last = {
        ok,
        status: response.status,
        error: ok ? undefined : `HTTP ${response.status}`,
        attempts: attempt,
      };
      await recordAttempt(db, endpoint.id, envelope.type, attempt, {
        ok,
        status: response.status,
        error: last.error,
        durationMs,
      });
      if (ok || !isRetryable(response.status)) break;
    } catch (error) {
      const message =
        error instanceof Error && error.name === 'TimeoutError'
          ? `Timed out after ${DELIVERY_TIMEOUT_MS / 1000}s`
          : error instanceof Error
            ? error.message
            : 'Network error';
      last = { ok: false, error: message, attempts: attempt };
      await recordAttempt(db, endpoint.id, envelope.type, attempt, {
        ok: false,
        error: message,
        durationMs: Date.now() - started,
      });
    }
  }

  try {
    await updateHealth(db, endpoint, last.ok);
    await pruneDeliveries(db, endpoint.id);
  } catch (error) {
    console.warn('[webhooks] bookkeeping failed:', error);
  }
  return last;
}

/** Send one event to every enabled endpoint of the tenant that subscribed to it. */
export async function dispatchWebhookEvent(
  db: SupabaseClient,
  params: { tenantId: string; type: WebhookEventName; data: unknown },
  deps: DeliveryDeps = {}
): Promise<void> {
  const { data, error } = await db
    .from('crm_webhook_endpoints')
    .select('id, tenant_id, url, secret_enc, events, consecutive_failures')
    .eq('tenant_id', params.tenantId)
    .eq('enabled', true)
    .contains('events', [params.type]);
  if (error) {
    // Table missing (migration 034 not applied): webhooks are simply off.
    console.warn('[webhooks] could not load endpoints:', error.message);
    return;
  }
  const endpoints = (data ?? []) as WebhookEndpoint[];
  if (endpoints.length === 0) return;

  const envelope = buildEnvelope(params.type, params.tenantId, params.data);
  await Promise.allSettled(
    endpoints.map((endpoint) => deliverToEndpoint(db, endpoint, envelope, deps))
  );
}

/** Fire and forget: logs any failure and never throws or blocks the caller. */
export function emitWebhookEvent(
  db: SupabaseClient,
  params: {
    tenantId: string | null | undefined;
    type: WebhookEventName;
    data: unknown;
  }
): void {
  if (!params.tenantId) return;
  dispatchWebhookEvent(db, {
    tenantId: params.tenantId,
    type: params.type,
    data: params.data,
  }).catch((error) => console.error('[webhooks] dispatch failed:', error));
}
