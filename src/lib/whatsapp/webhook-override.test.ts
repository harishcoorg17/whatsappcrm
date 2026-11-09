import { describe, expect, it } from 'vitest';
import {
  planOverrideFix,
  readOverrides,
  webhookUrlFromHeaders,
} from './webhook-override';

const DESIRED = 'https://crm.example.com/api/whatsapp/webhook';
const OLD = 'https://old.example.com/webhooks/whatsapp/+910000000000';

describe('readOverrides', () => {
  it('reads the phone, account and app callbacks', () => {
    const state = readOverrides(
      {
        data: [
          {
            whatsapp_business_api_data: { id: 'app1' },
            override_callback_uri: OLD,
          },
        ],
      },
      {
        webhook_configuration: {
          application: 'https://app.example.com/hook',
          phone_number: OLD,
        },
      },
      'app1'
    );
    expect(state).toEqual({
      phone: OLD,
      waba: OLD,
      app: 'https://app.example.com/hook',
    });
  });

  it('falls back to the account callback reported on the phone number', () => {
    const state = readOverrides(
      { data: [] },
      { webhook_configuration: { whatsapp_business_account: OLD } },
      'app1'
    );
    expect(state.waba).toBe(OLD);
  });

  it('returns nulls when nothing is overridden or Meta returned nothing', () => {
    expect(readOverrides(null, null, 'app1')).toEqual({
      phone: null,
      waba: null,
      app: null,
    });
    expect(
      readOverrides({ data: [{ override_callback_uri: '  ' }] }, {}, 'app1')
        .waba
    ).toBeNull();
  });
});

describe('planOverrideFix', () => {
  it('fixes only the overrides that point somewhere else', () => {
    expect(
      planOverrideFix({ phone: OLD, waba: null, app: null }, DESIRED)
    ).toEqual({ fixPhone: true, fixWaba: false });
    expect(
      planOverrideFix({ phone: null, waba: OLD, app: null }, DESIRED)
    ).toEqual({ fixPhone: false, fixWaba: true });
  });

  it('leaves an override that already points at the CRM alone', () => {
    expect(
      planOverrideFix({ phone: DESIRED, waba: DESIRED, app: null }, DESIRED)
    ).toEqual({ fixPhone: false, fixWaba: false });
  });

  it('does nothing when no override exists', () => {
    expect(
      planOverrideFix({ phone: null, waba: null, app: null }, DESIRED)
    ).toEqual({ fixPhone: false, fixWaba: false });
  });
});

describe('webhookUrlFromHeaders', () => {
  const headers = (values: Record<string, string>) => ({
    get: (name: string) => values[name.toLowerCase()] ?? null,
  });

  it('builds the URL from the forwarded public host', () => {
    expect(
      webhookUrlFromHeaders(
        headers({
          'x-forwarded-host': 'crm.example.com',
          'x-forwarded-proto': 'https',
        }),
        undefined
      )
    ).toBe(DESIRED);
  });

  it('uses the first value when a proxy chain adds several', () => {
    expect(
      webhookUrlFromHeaders(
        headers({
          'x-forwarded-host': 'crm.example.com, internal',
          'x-forwarded-proto': 'https, http',
        }),
        undefined
      )
    ).toBe(DESIRED);
  });

  it('refuses a non-https origin, which Meta would reject', () => {
    expect(
      webhookUrlFromHeaders(
        headers({ host: 'localhost:3010', 'x-forwarded-proto': 'http' }),
        undefined
      )
    ).toBeNull();
  });

  it('falls back to the configured site URL when no host header exists', () => {
    expect(webhookUrlFromHeaders(headers({}), 'https://crm.example.com/')).toBe(
      DESIRED
    );
    expect(webhookUrlFromHeaders(headers({}), undefined)).toBeNull();
  });
});
