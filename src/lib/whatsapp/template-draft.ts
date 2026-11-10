/**
 * Draft templates: rows that exist locally but were never sent to Meta.
 *
 * Meta's edit API only applies to templates that exist on Meta, so a draft is
 * edited locally and later submitted through the normal submit route, which
 * matches the same row by (user, name, language). That is why name and
 * language are never part of a draft update.
 */

import type { MessageTemplate } from '@/types';
import type { TemplatePayload } from './template-validators';

/** True for a template that has not been submitted to Meta yet. */
export function isDraftTemplate(
  template: Pick<MessageTemplate, 'status' | 'meta_template_id'>
): boolean {
  return (template.status ?? 'DRAFT') === 'DRAFT' && !template.meta_template_id;
}

/** The columns a draft save may change. Optional parts are cleared when removed. */
export function draftUpdateFromPayload(payload: TemplatePayload, now: string) {
  return {
    category: payload.category,
    header_type: payload.header_type ?? null,
    header_content: payload.header_content ?? null,
    header_media_url: payload.header_media_url ?? null,
    body_text: payload.body_text,
    footer_text: payload.footer_text ?? null,
    buttons: payload.buttons ?? null,
    sample_values: payload.sample_values ?? null,
    updated_at: now,
  };
}
