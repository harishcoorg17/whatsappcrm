import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sendTemplateToRecipient } from '@/lib/whatsapp/send-template-to-recipient';
import { loadWhatsAppCredentials } from '@/lib/whatsapp/credentials';
import { filterOptedOutRecipients } from '@/lib/whatsapp/consent';
import type { SendTimeParams } from '@/lib/whatsapp/template-send-builder';
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

interface BroadcastResult {
  phone: string;
  status: 'sent' | 'failed' | 'skipped';
  whatsapp_message_id?: string;
  error?: string;
}

/**
 * Two input shapes are accepted:
 *
 *   NEW (preferred — supports per-recipient variable substitution):
 *     {
 *       recipients: Array<{ phone: string; params: string[] }>,
 *       template_name, template_language
 *     }
 *
 *   LEGACY (all phones receive the same params — kept so existing
 *   callers don't break):
 *     {
 *       phone_numbers: string[],
 *       template_params: string[],
 *       template_name, template_language
 *     }
 *
 * Previous implementation only supported the legacy shape, and the
 * sending hook was forced to ship every batch with `templateParams[0]`
 * — meaning every recipient got contact-0's personalization. The new
 * shape is what actually fixes that.
 */
interface NewRecipient {
  phone: string;
  /** Body variable values, one per {{N}}. Legacy field. */
  params?: string[];
  /**
   * Structured per-send values (header text variable, media URL
   * override, URL/COPY_CODE button values). When set, takes
   * precedence over `params` for the body too — see
   * sendTemplateMessage for the merge rules.
   */
  messageParams?: SendTimeParams;
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Per-user broadcast budget. Note: this limits how often a user
    // can *start* a campaign, not how many messages go out inside
    // one — the fan-out loop below runs without additional gating.
    const limit = checkRateLimit(`broadcast:${user.id}`, RATE_LIMITS.broadcast);
    if (!limit.success) {
      return rateLimitResponse(limit);
    }

    const body = await request.json();
    const {
      recipients: newRecipients,
      phone_numbers,
      template_name,
      template_language,
      template_params,
    } = body;

    // Normalize to a list of {phone, params} regardless of shape.
    let recipients: NewRecipient[];
    if (Array.isArray(newRecipients) && newRecipients.length > 0) {
      recipients = newRecipients;
    } else if (Array.isArray(phone_numbers) && phone_numbers.length > 0) {
      const shared: string[] = Array.isArray(template_params)
        ? template_params
        : [];
      recipients = phone_numbers.map((phone: string) => ({
        phone,
        params: shared,
      }));
    } else {
      return NextResponse.json(
        {
          error:
            'Provide either `recipients` (preferred) or `phone_numbers` — must be a non-empty array',
        },
        { status: 400 }
      );
    }

    if (!template_name) {
      return NextResponse.json(
        { error: 'template_name is required' },
        { status: 400 }
      );
    }

    // Tenant connection first, legacy per-user config as the fallback.
    const credentials = await loadWhatsAppCredentials(supabase, user.id);

    if (!credentials) {
      return NextResponse.json(
        {
          error:
            'WhatsApp not configured. Please set up your WhatsApp integration first.',
        },
        { status: 400 }
      );
    }

    const { phoneNumberId, accessToken } = credentials;

    // Load the template row once so sendTemplateMessage can build
    // header + button components on each iteration. Loading inside
    // the loop would N+1 against Supabase for every recipient.
    // Guard against a malformed local row crashing every send in
    // the loop with the same opaque TypeError — fail loudly once.
    const { data: rawTemplateRow } = await supabase
      .from('message_templates')
      .select('*')
      .eq('user_id', user.id)
      .eq('name', template_name)
      .eq('language', template_language || 'en_US')
      .maybeSingle();
    if (rawTemplateRow && !isMessageTemplate(rawTemplateRow)) {
      return NextResponse.json(
        {
          error:
            'Template row is malformed locally — run "Sync from Meta" in Settings to repair it before broadcasting.',
        },
        { status: 500 }
      );
    }
    const templateRow = rawTemplateRow ?? null;

    const results: BroadcastResult[] = [];
    let sentCount = 0;
    let failedCount = 0;

    // Never message someone who replied STOP (or was opted out by hand).
    const { allowed, skipped } = await filterOptedOutRecipients(
      supabase,
      user.id,
      recipients
    );
    for (const recipient of skipped) {
      results.push({
        phone: recipient.phone,
        status: 'skipped',
        error: 'Opted out of marketing messages',
      });
    }

    for (const recipient of allowed) {
      const outcome = await sendTemplateToRecipient({
        phoneNumberId,
        accessToken,
        templateName: template_name,
        language: template_language || 'en_US',
        template: templateRow,
        recipient,
      });

      if (outcome.ok) {
        results.push({
          phone: recipient.phone,
          status: 'sent',
          whatsapp_message_id: outcome.messageId,
        });
        sentCount++;
      } else {
        console.error(
          `Failed to send broadcast to ${recipient.phone}:`,
          outcome.error
        );
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: outcome.error,
        });
        failedCount++;
      }
    }

    return NextResponse.json({
      success: true,
      total: recipients.length,
      sent: sentCount,
      failed: failedCount,
      skipped: skipped.length,
      results,
    });
  } catch (error) {
    console.error('Error in WhatsApp broadcast POST:', error);
    return NextResponse.json(
      { error: 'Failed to process broadcast' },
      { status: 500 }
    );
  }
}
