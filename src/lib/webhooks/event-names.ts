/**
 * Webhook event names and labels. Kept free of Node-only imports so the
 * browser dialog and the server code can share them.
 */

export const WEBHOOK_EVENTS = [
  'message.received',
  'message.sent',
  'contact.created',
] as const;

export type WebhookEventName = (typeof WEBHOOK_EVENTS)[number];
/** "ping" is only sent by the Test button; it is never a subscription. */
export type WebhookEventType = WebhookEventName | 'ping';

export const EVENT_LABELS: Record<WebhookEventName, string> = {
  'message.received': 'A customer sends a message',
  'message.sent': 'An agent sends a message',
  'contact.created': 'A new contact is created',
};

export function isWebhookEvent(value: unknown): value is WebhookEventName {
  return (
    typeof value === 'string' &&
    (WEBHOOK_EVENTS as readonly string[]).includes(value)
  );
}
