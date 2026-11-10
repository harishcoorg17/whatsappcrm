import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  executeSendTemplate,
  parseSendTemplateBody,
  renderTemplateBody,
} from './send-template';

describe('parseSendTemplateBody', () => {
  const valid = {
    to: '+919876543210',
    template_name: 'tour_purchase_confirmation',
    reference: 'booking-123:confirmation',
    params: ['Asha', 'Kerala'],
  };

  it('accepts a complete request and applies defaults', () => {
    expect(parseSendTemplateBody(valid)).toEqual({
      ok: true,
      value: {
        to: '+919876543210',
        templateName: 'tour_purchase_confirmation',
        language: 'en_US',
        reference: 'booking-123:confirmation',
        params: ['Asha', 'Kerala'],
        headerText: undefined,
        buttonParams: undefined,
        contactName: undefined,
      },
    });
  });

  it('passes through language, header, button params and contact name', () => {
    const result = parseSendTemplateBody({
      ...valid,
      language: 'en',
      header_text: 'Hi',
      button_params: { '1': 'abc' },
      contact_name: 'Asha Rao',
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        language: 'en',
        headerText: 'Hi',
        buttonParams: { 1: 'abc' },
        contactName: 'Asha Rao',
      },
    });
  });

  it('treats a missing params list as no variables', () => {
    const { params: _params, ...withoutParams } = valid;
    void _params;
    expect(parseSendTemplateBody(withoutParams)).toMatchObject({
      ok: true,
      value: { params: [] },
    });
  });

  it.each([
    ['not an object', 'x'],
    ['null', null],
    ['no to', { ...valid, to: '' }],
    ['no template', { ...valid, template_name: '' }],
    ['bad template name', { ...valid, template_name: 'Bad Name!' }],
    ['no reference', { ...valid, reference: '' }],
    ['reference too long', { ...valid, reference: 'x'.repeat(129) }],
    ['params not an array', { ...valid, params: 'Asha' }],
    ['a non-string param', { ...valid, params: ['Asha', 5] }],
    ['too many params', { ...valid, params: Array(21).fill('x') }],
    ['a param that is too long', { ...valid, params: ['x'.repeat(1025)] }],
  ])('rejects %s', (_label, body) => {
    expect(parseSendTemplateBody(body).ok).toBe(false);
  });
});

describe('renderTemplateBody', () => {
  it('fills numbered variables', () => {
    expect(
      renderTemplateBody('Hi {{1}}, trip {{2}}.', ['Asha', 'Kerala'])
    ).toBe('Hi Asha, trip Kerala.');
  });

  it('leaves a variable without a value untouched', () => {
    expect(renderTemplateBody('Hi {{1}} {{2}}', ['Asha'])).toBe(
      'Hi Asha {{2}}'
    );
  });
});

// ---------------------------------------------------------------- execute

interface FakeState {
  sends: Map<string, Record<string, unknown>>;
  template: Record<string, unknown> | null;
  upserts: Array<Record<string, unknown>>;
}

const state: FakeState = { sends: new Map(), template: null, upserts: [] };

function fakeDb() {
  return {
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return query;
        },
        maybeSingle: async () => {
          if (table === 'crm_integration_sends') {
            return {
              data: state.sends.get(String(filters.reference)) ?? null,
              error: null,
            };
          }
          if (table === 'message_templates') {
            return { data: state.template, error: null };
          }
          throw new Error(`unexpected table ${table}`);
        },
        upsert: async (row: Record<string, unknown>) => {
          state.upserts.push(row);
          state.sends.set(String(row.reference), row);
          return { error: null };
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
}

const sendTemplate = vi.fn();
const loadCredentials = vi.fn();
const record = vi.fn();

const AUTH = { keyId: 'k1', tenantId: 't1', ownerUserId: 'u1' };

const INPUT = {
  to: '+91 98765 43210',
  templateName: 'tour_purchase_confirmation',
  language: 'en_US',
  reference: 'booking-123:confirmation',
  params: ['Asha', 'Kerala'],
  headerText: undefined,
  buttonParams: undefined,
  contactName: 'Asha Rao',
};

function approvedTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tpl1',
    user_id: 'u1',
    name: 'tour_purchase_confirmation',
    language: 'en_US',
    category: 'Utility',
    body_text: 'Hi {{1}}, your {{2}} trip is confirmed.',
    status: 'APPROVED',
    meta_template_id: 'meta-1',
    ...overrides,
  };
}

function run(input = INPUT) {
  return executeSendTemplate({
    db: fakeDb(),
    auth: AUTH,
    input,
    deps: {
      sendTemplate: sendTemplate as never,
      loadCredentials: loadCredentials as never,
      record: record as never,
    },
  });
}

beforeEach(() => {
  state.sends = new Map();
  state.template = approvedTemplate();
  state.upserts = [];
  sendTemplate.mockReset().mockResolvedValue({ messageId: 'wamid.1' });
  loadCredentials.mockReset().mockResolvedValue({
    phoneNumberId: 'pn-amstago',
    accessToken: 'tenant-token',
    wabaId: 'waba-1',
    source: 'tenant',
  });
  record.mockReset().mockResolvedValue({ conversationId: 'c1' });
});

describe('executeSendTemplate', () => {
  it("sends from the tenant's number, saves it to the inbox and logs it", async () => {
    const result = await run();

    expect(result).toEqual({
      ok: true,
      status: 'sent',
      messageId: 'wamid.1',
      conversationId: 'c1',
    });
    expect(loadCredentials).toHaveBeenCalledWith(expect.anything(), 'u1', 't1');
    expect(sendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumberId: 'pn-amstago',
        accessToken: 'tenant-token',
        to: '919876543210',
        templateName: 'tour_purchase_confirmation',
        language: 'en_US',
        messageParams: expect.objectContaining({ body: ['Asha', 'Kerala'] }),
      })
    );
    expect(record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: 't1',
        ownerUserId: 'u1',
        phone: '919876543210',
        contactName: 'Asha Rao',
        templateName: 'tour_purchase_confirmation',
        bodyText: 'Hi Asha, your Kerala trip is confirmed.',
        messageId: 'wamid.1',
      })
    );
    expect(state.upserts.at(-1)).toMatchObject({
      tenant_id: 't1',
      reference: 'booking-123:confirmation',
      status: 'sent',
      whatsapp_message_id: 'wamid.1',
    });
  });

  it('answers a repeated reference without messaging the customer again', async () => {
    await run();
    sendTemplate.mockClear();

    const again = await run();

    expect(again).toEqual({
      ok: true,
      status: 'duplicate',
      messageId: 'wamid.1',
      conversationId: 'c1',
    });
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it('retries a reference whose earlier attempt failed', async () => {
    sendTemplate.mockRejectedValueOnce(new Error('Meta is down'));
    expect((await run()).ok).toBe(false);

    const retry = await run();
    expect(retry).toMatchObject({ ok: true, status: 'sent' });
    expect(sendTemplate).toHaveBeenCalledTimes(2);
  });

  it('reports an unknown template', async () => {
    state.template = null;
    expect(await run()).toMatchObject({
      ok: false,
      code: 'template_not_found',
      httpStatus: 404,
    });
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it.each(['DRAFT', 'PENDING', 'REJECTED', 'PAUSED', 'DISABLED'])(
    'refuses a template that is %s',
    async (status) => {
      state.template = approvedTemplate({ status });
      expect(await run()).toMatchObject({
        ok: false,
        code: 'template_not_approved',
        httpStatus: 409,
      });
      expect(sendTemplate).not.toHaveBeenCalled();
    }
  );

  it('refuses the wrong number of variables', async () => {
    expect(await run({ ...INPUT, params: ['Asha'] })).toMatchObject({
      ok: false,
      code: 'invalid_params',
      httpStatus: 422,
    });
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it('refuses an invalid phone number', async () => {
    expect(await run({ ...INPUT, to: 'not a phone' })).toMatchObject({
      ok: false,
      code: 'invalid_phone',
      httpStatus: 422,
    });
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it('reports a tenant with no WhatsApp connection', async () => {
    loadCredentials.mockResolvedValue(null);
    expect(await run()).toMatchObject({
      ok: false,
      code: 'whatsapp_not_connected',
      httpStatus: 409,
    });
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it('logs a failed send and reports it as a gateway error', async () => {
    sendTemplate.mockRejectedValue(new Error('Re-engagement message'));
    expect(await run()).toMatchObject({
      ok: false,
      code: 'send_failed',
      httpStatus: 502,
    });
    expect(state.upserts.at(-1)).toMatchObject({
      status: 'failed',
      error: 'Re-engagement message',
    });
    expect(record).not.toHaveBeenCalled();
  });

  it('still reports success when only saving to the inbox fails', async () => {
    record.mockRejectedValue(new Error('db down'));
    expect(await run()).toMatchObject({
      ok: true,
      status: 'sent',
      messageId: 'wamid.1',
      conversationId: null,
    });
  });
});
