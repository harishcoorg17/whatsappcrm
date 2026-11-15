import { randomUUID } from 'node:crypto';

/**
 * Events a tenant can subscribe an outbound webhook to. Every delivery is a
 * JSON envelope: { id, type, createdAt, tenantId, data }.
 */
import {
  EVENT_LABELS,
  isWebhookEvent,
  WEBHOOK_EVENTS,
  type WebhookEventName,
  type WebhookEventType,
} from './event-names';

// Re-exported so existing imports keep working; the definitions live in
// event-names.ts, which has no Node-only imports and is safe in the browser.
export { EVENT_LABELS, isWebhookEvent, WEBHOOK_EVENTS };
export type { WebhookEventName, WebhookEventType };

export const DEFAULT_EVENTS: readonly WebhookEventName[] = WEBHOOK_EVENTS;
export const MAX_ENDPOINTS_PER_TENANT = 10;
export const MAX_DESCRIPTION_LENGTH = 120;

export interface WebhookEnvelope<T = unknown> {
  /** Unique per event; the same value is sent again on a retry (dedupe on it). */
  id: string;
  type: WebhookEventType;
  createdAt: string;
  tenantId: string;
  data: T;
}

/** Validate an events list from a request; duplicates are dropped. */
export function parseEvents(
  input: unknown
): { ok: true; events: WebhookEventName[] } | { ok: false; error: string } {
  if (input === undefined) return { ok: true, events: [...DEFAULT_EVENTS] };
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, error: 'Choose at least one event' };
  }
  const unknown = input.filter((e) => !isWebhookEvent(e));
  if (unknown.length > 0) {
    return { ok: false, error: `Unknown event: ${String(unknown[0])}` };
  }
  return { ok: true, events: [...new Set(input as WebhookEventName[])] };
}

export function buildEnvelope<T>(
  type: WebhookEventType,
  tenantId: string,
  data: T,
  options: { now?: Date; id?: string } = {}
): WebhookEnvelope<T> {
  return {
    id: options.id ?? randomUUID(),
    type,
    createdAt: (options.now ?? new Date()).toISOString(),
    tenantId,
    data,
  };
}
