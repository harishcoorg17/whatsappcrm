/**
 * Server-to-server "send this approved template" for the integration API.
 *
 * The caller (for example the Amstago backend) names a template, a phone
 * number, the variable values and its OWN `reference` for the message
 * (like "booking-123:confirmation"). The CRM:
 *   1. answers a repeated reference from its log instead of messaging twice;
 *   2. only sends templates Meta has APPROVED, with the right variable count;
 *   3. sends from the tenant's own WhatsApp number;
 *   4. saves the message in the inbox so agents see what the customer got.
 *
 * Collaborators are passed in, so the flow is tested without network calls.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { WhatsAppCredentials } from '@/lib/whatsapp/credentials';
import { isValidE164, sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard';
import type { SendTimeParams } from '@/lib/whatsapp/template-send-builder';
import { extractVariableIndices } from '@/lib/whatsapp/template-validators';
import type { MessageTemplate } from '@/types';
import type { AuthenticatedKey } from './api-key';

const TEMPLATE_NAME = /^[a-z0-9_]{1,512}$/;
const LANGUAGE = /^[a-z]{2,3}(_[A-Za-z]{2,4})?$/;
const MAX_REFERENCE_LENGTH = 128;
const MAX_PARAMS = 20;
const MAX_PARAM_LENGTH = 1024;
const MAX_HEADER_TEXT_LENGTH = 200;
const MAX_CONTACT_NAME_LENGTH = 120;
const MAX_PHONE_INPUT_LENGTH = 32;

export interface SendTemplateInput {
  to: string;
  templateName: string;
  language: string;
  reference: string;
  params: string[];
  headerText?: string;
  buttonParams?: Record<number, string>;
  contactName?: string;
}

export type ParseResult =
  | { ok: true; value: SendTemplateInput }
  | { ok: false; error: string };

function fail(error: string): ParseResult {
  return { ok: false, error };
}

export function parseSendTemplateBody(raw: unknown): ParseResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return fail('Body must be a JSON object.');
  }
  const body = raw as Record<string, unknown>;

  const to = typeof body.to === 'string' ? body.to.trim() : '';
  if (!to || to.length > MAX_PHONE_INPUT_LENGTH) {
    return fail('"to" (phone number) is required.');
  }

  const templateName =
    typeof body.template_name === 'string' ? body.template_name : '';
  if (!TEMPLATE_NAME.test(templateName)) {
    return fail(
      '"template_name" is required: lowercase letters, digits and underscores.'
    );
  }

  const reference =
    typeof body.reference === 'string' ? body.reference.trim() : '';
  if (!reference || reference.length > MAX_REFERENCE_LENGTH) {
    return fail(
      `"reference" is required (1-${MAX_REFERENCE_LENGTH} characters), for example "booking-123:confirmation".`
    );
  }

  const language =
    body.language === undefined ? 'en_US' : String(body.language);
  if (!LANGUAGE.test(language)) {
    return fail('"language" must be a code such as en_US.');
  }

  let params: string[] = [];
  if (body.params !== undefined) {
    if (
      !Array.isArray(body.params) ||
      body.params.length > MAX_PARAMS ||
      !body.params.every(
        (p) => typeof p === 'string' && p.length <= MAX_PARAM_LENGTH
      )
    ) {
      return fail(
        `"params" must be a list of up to ${MAX_PARAMS} strings, each up to ${MAX_PARAM_LENGTH} characters.`
      );
    }
    params = body.params as string[];
  }

  let headerText: string | undefined;
  if (body.header_text !== undefined) {
    if (
      typeof body.header_text !== 'string' ||
      body.header_text.length > MAX_HEADER_TEXT_LENGTH
    ) {
      return fail('"header_text" must be a short string.');
    }
    headerText = body.header_text;
  }

  let buttonParams: Record<number, string> | undefined;
  if (body.button_params !== undefined) {
    const source = body.button_params;
    if (
      source === null ||
      typeof source !== 'object' ||
      Array.isArray(source)
    ) {
      return fail('"button_params" must be an object like {"1": "value"}.');
    }
    buttonParams = {};
    for (const [index, value] of Object.entries(source)) {
      if (!/^\d+$/.test(index) || typeof value !== 'string') {
        return fail('"button_params" must map button positions to strings.');
      }
      buttonParams[Number(index)] = value;
    }
  }

  let contactName: string | undefined;
  if (body.contact_name !== undefined) {
    if (
      typeof body.contact_name !== 'string' ||
      body.contact_name.length > MAX_CONTACT_NAME_LENGTH
    ) {
      return fail('"contact_name" must be a short string.');
    }
    contactName = body.contact_name;
  }

  return {
    ok: true,
    value: {
      to,
      templateName,
      language,
      reference,
      params,
      headerText,
      buttonParams,
      contactName,
    },
  };
}

/** The template body as the customer sees it, for the inbox copy. */
export function renderTemplateBody(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (whole, index: string) => {
    const value = params[Number(index) - 1];
    return value === undefined ? whole : value;
  });
}

export interface RecordArgs {
  tenantId: string;
  ownerUserId: string;
  phone: string;
  contactName?: string;
  templateName: string;
  bodyText: string;
  messageId: string;
}

export interface SendTemplateDeps {
  sendTemplate: (args: {
    phoneNumberId: string;
    accessToken: string;
    to: string;
    templateName: string;
    language: string;
    template: MessageTemplate;
    messageParams: SendTimeParams;
  }) => Promise<{ messageId: string }>;
  loadCredentials: (
    db: SupabaseClient,
    ownerUserId: string,
    tenantId: string
  ) => Promise<WhatsAppCredentials | null>;
  record: (
    db: SupabaseClient,
    args: RecordArgs
  ) => Promise<{ conversationId: string }>;
}

export type SendTemplateResult =
  | {
      ok: true;
      status: 'sent' | 'duplicate';
      messageId: string | null;
      conversationId: string | null;
    }
  | { ok: false; code: string; message: string; httpStatus: number };

function failure(
  code: string,
  message: string,
  httpStatus: number
): SendTemplateResult {
  return { ok: false, code, message, httpStatus };
}

async function logSend(
  db: SupabaseClient,
  row: Record<string, unknown>
): Promise<void> {
  const { error } = await db
    .from('crm_integration_sends')
    .upsert(
      { ...row, updated_at: new Date().toISOString() },
      { onConflict: 'tenant_id,reference' }
    );
  if (error) {
    console.error('[integrations/send-template] log failed:', error.message);
  }
}

export async function executeSendTemplate(params: {
  db: SupabaseClient;
  auth: AuthenticatedKey;
  input: SendTemplateInput;
  deps: SendTemplateDeps;
}): Promise<SendTemplateResult> {
  const { db, auth, input, deps } = params;

  // 1. Same reference already delivered: answer from the log.
  const { data: previous } = await db
    .from('crm_integration_sends')
    .select('status, whatsapp_message_id, conversation_id')
    .eq('tenant_id', auth.tenantId)
    .eq('reference', input.reference)
    .maybeSingle();
  const earlier = previous as {
    status: string;
    whatsapp_message_id: string | null;
    conversation_id: string | null;
  } | null;
  if (earlier?.status === 'sent') {
    return {
      ok: true,
      status: 'duplicate',
      messageId: earlier.whatsapp_message_id,
      conversationId: earlier.conversation_id,
    };
  }

  // 2. The template must exist for this tenant's owner and be approved.
  const { data: templateRow } = await db
    .from('message_templates')
    .select('*')
    .eq('user_id', auth.ownerUserId)
    .eq('name', input.templateName)
    .eq('language', input.language)
    .maybeSingle();
  if (!templateRow) {
    return failure(
      'template_not_found',
      `Template "${input.templateName}" (${input.language}) does not exist.`,
      404
    );
  }
  if (!isMessageTemplate(templateRow)) {
    return failure(
      'template_invalid',
      'The stored template is malformed. Run "Sync from Meta" to repair it.',
      500
    );
  }
  const template = templateRow as MessageTemplate;
  if (template.status !== 'APPROVED') {
    return failure(
      'template_not_approved',
      `Template "${input.templateName}" is ${template.status ?? 'DRAFT'}; only APPROVED templates can be sent.`,
      409
    );
  }

  // 3. Variables: exactly as many values as the body has variables.
  const expected = extractVariableIndices(template.body_text).length;
  if (input.params.length !== expected) {
    return failure(
      'invalid_params',
      `Template "${input.templateName}" needs ${expected} body variable(s); got ${input.params.length}.`,
      422
    );
  }

  // 4. Phone number.
  const phone = sanitizePhoneForMeta(input.to);
  if (!isValidE164(phone)) {
    return failure('invalid_phone', 'Invalid phone number format.', 422);
  }

  // 5. The tenant's own WhatsApp number.
  const credentials = await deps.loadCredentials(
    db,
    auth.ownerUserId,
    auth.tenantId
  );
  if (!credentials) {
    return failure(
      'whatsapp_not_connected',
      'This tenant has no connected WhatsApp number.',
      409
    );
  }

  // 6. Send.
  let messageId: string;
  try {
    const sent = await deps.sendTemplate({
      phoneNumberId: credentials.phoneNumberId,
      accessToken: credentials.accessToken,
      to: phone,
      templateName: input.templateName,
      language: input.language,
      template,
      messageParams: {
        body: input.params,
        headerText: input.headerText,
        buttonParams: input.buttonParams,
      },
    });
    messageId = sent.messageId;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown Meta API error';
    await logSend(db, {
      tenant_id: auth.tenantId,
      reference: input.reference,
      template_name: input.templateName,
      to_phone: phone,
      status: 'failed',
      error: message,
    });
    return failure('send_failed', `Meta API error: ${message}`, 502);
  }

  // 7. Inbox copy. The message is already out, so a failure here must not
  //    turn a delivered message into an error the caller would retry.
  let conversationId: string | null = null;
  try {
    const recorded = await deps.record(db, {
      tenantId: auth.tenantId,
      ownerUserId: auth.ownerUserId,
      phone,
      contactName: input.contactName,
      templateName: input.templateName,
      bodyText: renderTemplateBody(template.body_text, input.params),
      messageId,
    });
    conversationId = recorded.conversationId;
  } catch (error) {
    console.error(
      '[integrations/send-template] inbox record failed:',
      error instanceof Error ? error.message : error
    );
  }

  await logSend(db, {
    tenant_id: auth.tenantId,
    reference: input.reference,
    template_name: input.templateName,
    to_phone: phone,
    status: 'sent',
    whatsapp_message_id: messageId,
    conversation_id: conversationId,
    error: null,
  });

  return { ok: true, status: 'sent', messageId, conversationId };
}
