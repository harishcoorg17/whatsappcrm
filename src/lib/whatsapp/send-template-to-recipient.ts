import { sendTemplateMessage } from './meta-api';
import type { SendTimeParams } from './template-send-builder';
import type { MessageTemplate } from '@/types';
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from './phone-utils';

export interface TemplateRecipient {
  phone: string;
  /** Body variable values, one per {{N}}. Legacy field. */
  params?: string[];
  /** Structured per-send values (header, media, buttons). */
  messageParams?: SendTimeParams;
}

export interface SendToRecipientArgs {
  phoneNumberId: string;
  accessToken: string;
  templateName: string;
  language: string;
  template: MessageTemplate | null;
  recipient: TemplateRecipient;
}

export type SendToRecipientResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string };

/**
 * Sends one template message. Shared by the interactive broadcast route and
 * the scheduled-broadcast cron so both validate and retry identically.
 *
 * Retries phone variants on "not in allowed list" so numbers that differ only
 * by a trunk-prefix 0 still reach recipients.
 */
export async function sendTemplateToRecipient(
  args: SendToRecipientArgs
): Promise<SendToRecipientResult> {
  const { recipient } = args;
  const sanitized = sanitizePhoneForMeta(recipient.phone);
  if (!isValidE164(sanitized)) {
    return { ok: false, error: 'Invalid phone number format' };
  }

  let lastError: string | null = null;
  for (const variant of phoneVariants(sanitized)) {
    try {
      const result = await sendTemplateMessage({
        phoneNumberId: args.phoneNumberId,
        accessToken: args.accessToken,
        to: variant,
        templateName: args.templateName,
        language: args.language,
        template: args.template ?? undefined,
        messageParams: recipient.messageParams,
        params: recipient.params ?? [],
      });
      return { ok: true, messageId: result.messageId };
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Unknown error';
      if (!isRecipientNotAllowedError(lastError)) break;
    }
  }
  return { ok: false, error: lastError ?? 'Unknown error' };
}
