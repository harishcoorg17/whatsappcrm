import { describe, expect, it, vi } from 'vitest';
import {
  contextToVars,
  fetchCustomerContext,
  parseCustomerContext,
  type CustomerContext,
} from './customer-context';

const PRIMARY = {
  reference: 'B1111111',
  status: 'confirmed',
  tour_title: 'Kerala Hills & Backwaters',
  tour_slug: 'kerala-hills',
  duration_days: 5,
  start_date: '2026-12-14',
  end_date: '2026-12-18',
  total_amount: 29404,
  amount_paid: 29404,
  amount_due: 0,
  payment_status: 'paid',
  is_upcoming: true,
};

const FOUND = {
  found: true,
  customer: { id: 'user-1', name: 'Asha Rao', first_name: 'Asha' },
  booking_count: 1,
  primary: PRIMARY,
  bookings: [PRIMARY],
};

describe('parseCustomerContext', () => {
  it('accepts a found customer with a primary booking', () => {
    expect(parseCustomerContext(FOUND)).toMatchObject({
      customer: { id: 'user-1', firstName: 'Asha' },
      bookingCount: 1,
      primary: {
        reference: 'B1111111',
        tourTitle: 'Kerala Hills & Backwaters',
      },
    });
  });

  it('accepts a found customer with no bookings', () => {
    expect(
      parseCustomerContext({
        ...FOUND,
        booking_count: 0,
        primary: null,
        bookings: [],
      })
    ).toMatchObject({ bookingCount: 0, primary: null });
  });

  it.each([
    ['not found', { found: false }],
    ['ambiguous', { found: false, ambiguous: true }],
    ['null', null],
    ['a string', 'x'],
    ['no customer', { found: true }],
    ['a customer without an id', { found: true, customer: { name: 'A' } }],
  ])('returns null for %s', (_label, body) => {
    expect(parseCustomerContext(body)).toBeNull();
  });

  it('ignores a malformed primary booking instead of trusting it', () => {
    expect(
      parseCustomerContext({ ...FOUND, primary: { reference: 5 } })
    ).toMatchObject({ primary: null });
  });
});

function ctx(): CustomerContext {
  return parseCustomerContext(FOUND) as CustomerContext;
}

describe('contextToVars', () => {
  it('turns a paid upcoming booking into flow variables', () => {
    const vars = contextToVars(ctx());
    expect(vars).toMatchObject({
      customer_first_name: 'Asha',
      customer_name: 'Asha Rao',
      has_booking: 'yes',
      booking_count: '1',
      booking_reference: 'B1111111',
      booking_title: 'Kerala Hills & Backwaters',
      booking_url: 'https://amstago.com/tours/kerala-hills',
      booking_dates: '14–18 Dec 2026',
      booking_status: 'confirmed',
      payment_status: 'paid',
      amount_paid: '₹29,404',
      amount_due: '₹0',
      trip_is_upcoming: 'yes',
    });
    expect(vars.payment_text).toMatch(/paid in full/i);
  });

  it('describes a balance due', () => {
    const base = ctx();
    const vars = contextToVars({
      ...base,
      primary: {
        ...base.primary!,
        paymentStatus: 'part_paid',
        amountPaid: 10000,
        amountDue: 19404,
      },
    });
    expect(vars.payment_status).toBe('part_paid');
    expect(vars.amount_due).toBe('₹19,404');
    expect(vars.payment_text).toContain('₹19,404');
  });

  it('formats dates that span two months', () => {
    const base = ctx();
    const vars = contextToVars({
      ...base,
      primary: {
        ...base.primary!,
        startDate: '2026-12-28',
        endDate: '2027-01-02',
      },
    });
    expect(vars.booking_dates).toBe('28 Dec 2026 – 2 Jan 2027');
  });

  it('formats a single-day trip', () => {
    const base = ctx();
    const vars = contextToVars({
      ...base,
      primary: {
        ...base.primary!,
        startDate: '2026-12-14',
        endDate: '2026-12-14',
      },
    });
    expect(vars.booking_dates).toBe('14 Dec 2026');
  });

  it('says dates are to be confirmed when there are none', () => {
    const base = ctx();
    const vars = contextToVars({
      ...base,
      primary: { ...base.primary!, startDate: null, endDate: null },
    });
    expect(vars.booking_dates).toBe('dates to be confirmed');
  });

  it('marks a customer with no booking and leaves booking variables empty', () => {
    const vars = contextToVars({ ...ctx(), bookingCount: 0, primary: null });
    expect(vars).toMatchObject({
      customer_first_name: 'Asha',
      has_booking: 'no',
      booking_count: '0',
      booking_title: '',
      booking_url: '',
    });
  });

  it('falls back to a friendly word when the customer has no name', () => {
    const base = ctx();
    const vars = contextToVars({
      ...base,
      customer: { id: 'u', name: null, firstName: null },
    });
    expect(vars.customer_first_name).toBe('there');
  });

  it('uses a different site for tour links when given one', () => {
    const vars = contextToVars(ctx(), { siteUrl: 'https://example.org/' });
    expect(vars.booking_url).toBe('https://example.org/tours/kerala-hills');
  });

  it('only produces string values, as flow variables must be', () => {
    for (const value of Object.values(contextToVars(ctx()))) {
      expect(typeof value).toBe('string');
    }
  });
});

describe('fetchCustomerContext', () => {
  const base = {
    apiBase: 'https://api.example.com/api',
    apiKey: 'integration-secret',
    phone: '919876543210',
  };

  function ok(body: unknown) {
    return vi.fn(
      async () => new Response(JSON.stringify(body), { status: 200 })
    );
  }

  it('calls the lookup with the key and the encoded phone number', async () => {
    const fetchImpl = ok(FOUND);
    const result = await fetchCustomerContext({ ...base, fetchImpl });

    expect(result?.customer.firstName).toBe('Asha');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      'https://api.example.com/api/crm-integration/customers/lookup?phone=919876543210'
    );
    expect((init.headers as Record<string, string>)['x-integration-key']).toBe(
      'integration-secret'
    );
    expect(init.redirect).toBe('manual');
    expect(init.method).toBe('GET');
  });

  it('returns null for a number the backend does not know', async () => {
    expect(
      await fetchCustomerContext({ ...base, fetchImpl: ok({ found: false }) })
    ).toBeNull();
  });

  it.each([401, 404, 500])('returns null on HTTP %i', async (status) => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status }));
    expect(await fetchCustomerContext({ ...base, fetchImpl })).toBeNull();
  });

  it('returns null on invalid JSON', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('<html>', { status: 200 })
    );
    expect(await fetchCustomerContext({ ...base, fetchImpl })).toBeNull();
  });

  it('returns null when the request throws or times out', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('boom');
    });
    expect(await fetchCustomerContext({ ...base, fetchImpl })).toBeNull();
  });

  it('returns null when the response is too large', async () => {
    const fetchImpl = ok({ ...FOUND, junk: 'x'.repeat(200) });
    expect(
      await fetchCustomerContext({ ...base, fetchImpl, maxBytes: 50 })
    ).toBeNull();
  });

  it('refuses a base that is not plain https, without calling out', async () => {
    const fetchImpl = ok(FOUND);
    expect(
      await fetchCustomerContext({
        ...base,
        apiBase: 'http://api.example.com',
        fetchImpl,
      })
    ).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses when the host guard says the host is not public', async () => {
    const fetchImpl = ok(FOUND);
    const hostGuard = vi.fn(async () => false);
    expect(
      await fetchCustomerContext({ ...base, fetchImpl, hostGuard })
    ).toBeNull();
    expect(hostGuard).toHaveBeenCalledWith('api.example.com');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not call out without a key or a phone number', async () => {
    const fetchImpl = ok(FOUND);
    expect(
      await fetchCustomerContext({ ...base, apiKey: '', fetchImpl })
    ).toBeNull();
    expect(
      await fetchCustomerContext({ ...base, phone: '', fetchImpl })
    ).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
