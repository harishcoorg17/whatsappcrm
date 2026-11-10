import { describe, expect, it } from 'vitest';
import { draftUpdateFromPayload, isDraftTemplate } from './template-draft';

describe('isDraftTemplate', () => {
  it('is true for a DRAFT that was never sent to Meta', () => {
    expect(
      isDraftTemplate({ status: 'DRAFT', meta_template_id: undefined })
    ).toBe(true);
    expect(
      isDraftTemplate({ status: 'DRAFT', meta_template_id: null as never })
    ).toBe(true);
  });

  it('treats a missing status as a draft', () => {
    expect(isDraftTemplate({})).toBe(true);
  });

  it('is false once the template exists on Meta', () => {
    expect(
      isDraftTemplate({ status: 'DRAFT', meta_template_id: 'meta-1' })
    ).toBe(false);
  });

  it.each(['PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED'] as const)(
    'is false for %s',
    (status) => {
      expect(isDraftTemplate({ status })).toBe(false);
    }
  );
});

describe('draftUpdateFromPayload', () => {
  const NOW = '2026-11-10T12:00:00.000Z';

  it('carries the editable fields and the update time', () => {
    const update = draftUpdateFromPayload(
      {
        name: 'refund_processed',
        category: 'Utility',
        language: 'en_US',
        header_type: 'text',
        header_content: 'Refund processed',
        body_text: 'Hi {{1}}, refund of {{2}}.',
        footer_text: 'Amstago',
        buttons: [{ type: 'QUICK_REPLY', text: 'Contact support' }],
        sample_values: { body: ['Asha', '₹100'] },
      },
      NOW
    );
    expect(update).toEqual({
      category: 'Utility',
      header_type: 'text',
      header_content: 'Refund processed',
      header_media_url: null,
      body_text: 'Hi {{1}}, refund of {{2}}.',
      footer_text: 'Amstago',
      buttons: [{ type: 'QUICK_REPLY', text: 'Contact support' }],
      sample_values: { body: ['Asha', '₹100'] },
      updated_at: NOW,
    });
  });

  it('never changes the name or language, which identify the row', () => {
    const update = draftUpdateFromPayload(
      {
        name: 'renamed',
        category: 'Marketing',
        language: 'hi',
        body_text: 'Hello',
      },
      NOW
    );
    expect(update).not.toHaveProperty('name');
    expect(update).not.toHaveProperty('language');
  });

  it('clears optional parts that were removed', () => {
    const update = draftUpdateFromPayload(
      { name: 'x', category: 'Utility', language: 'en_US', body_text: 'Hi' },
      NOW
    );
    expect(update).toMatchObject({
      header_type: null,
      header_content: null,
      header_media_url: null,
      footer_text: null,
      buttons: null,
      sample_values: null,
    });
  });
});
