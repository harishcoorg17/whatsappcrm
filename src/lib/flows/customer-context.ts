/**
 * Customer context for returning-customer flows.
 *
 * When a customer messages, the CRM asks the tenant's own backend "who is this
 * number and what have they booked?" (GET {api}/crm-integration/customers/lookup,
 * protected by a shared key). The answer becomes flow variables, so a flow can
 * say "I see you're booked on {{vars.booking_title}} ({{vars.booking_dates}})".
 *
 * The lookup follows the same guard rails as the live-data node: https only,
 * a public host, no redirects, a short timeout and a size cap. Any problem
 * returns null, and the conversation simply carries on as it would for any
 * other customer.
 */

import { hostFromTemplate, readCapped } from './http-fetch';

const DEFAULT_SITE_URL = 'https://amstago.com';
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_BYTES = 64 * 1024;
const LOOKUP_PATH = '/crm-integration/customers/lookup';
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const EN_DASH = '–';

export type PaymentStatus = 'paid' | 'part_paid' | 'unpaid' | 'failed';
const PAYMENT_STATUSES: readonly string[] = [
  'paid',
  'part_paid',
  'unpaid',
  'failed',
];

export interface BookingContext {
  reference: string;
  status: string;
  tourTitle: string | null;
  tourSlug: string | null;
  durationDays: number | null;
  startDate: string | null;
  endDate: string | null;
  totalAmount: number;
  amountPaid: number;
  amountDue: number;
  paymentStatus: PaymentStatus;
  isUpcoming: boolean;
}

export interface CustomerContext {
  customer: { id: string; name: string | null; firstName: string | null };
  bookingCount: number;
  primary: BookingContext | null;
}

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;
const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

function parsePrimary(raw: unknown): BookingContext | null {
  if (raw === null || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const reference = asString(row.reference);
  const status = asString(row.status);
  const paymentStatus = row.payment_status;
  const total = asNumber(row.total_amount);
  const paid = asNumber(row.amount_paid);
  const due = asNumber(row.amount_due);
  if (
    !reference ||
    !status ||
    total === null ||
    paid === null ||
    due === null ||
    typeof paymentStatus !== 'string' ||
    !PAYMENT_STATUSES.includes(paymentStatus)
  ) {
    return null;
  }
  return {
    reference,
    status,
    tourTitle: asString(row.tour_title),
    tourSlug: asString(row.tour_slug),
    durationDays: asNumber(row.duration_days),
    startDate: asString(row.start_date),
    endDate: asString(row.end_date),
    totalAmount: total,
    amountPaid: paid,
    amountDue: due,
    paymentStatus: paymentStatus as PaymentStatus,
    isUpcoming: row.is_upcoming === true,
  };
}

/** The backend's lookup answer as a typed context, or null if it is not a match. */
export function parseCustomerContext(body: unknown): CustomerContext | null {
  if (body === null || typeof body !== 'object') return null;
  const data = body as Record<string, unknown>;
  if (data.found !== true) return null;

  const customer = data.customer;
  if (customer === null || typeof customer !== 'object') return null;
  const c = customer as Record<string, unknown>;
  const id = asString(c.id);
  if (!id) return null;

  return {
    customer: { id, name: asString(c.name), firstName: asString(c.first_name) },
    bookingCount: asNumber(data.booking_count) ?? 0,
    primary: parsePrimary(data.primary),
  };
}

const rupees = (amount: number): string =>
  `₹${Math.round(amount).toLocaleString('en-IN')}`;

function dayParts(
  iso: string
): { day: number; month: number; year: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]) - 1,
    day: Number(match[3]),
  };
}

function formatTripDates(start: string | null, end: string | null): string {
  const from = start ? dayParts(start) : null;
  const to = end ? dayParts(end) : null;
  if (!from) return 'dates to be confirmed';

  const label = (d: { day: number; month: number; year: number }) =>
    `${d.day} ${MONTHS[d.month]} ${d.year}`;
  if (
    !to ||
    (to.day === from.day && to.month === from.month && to.year === from.year)
  ) {
    return label(from);
  }
  if (to.month === from.month && to.year === from.year) {
    return `${from.day}${EN_DASH}${to.day} ${MONTHS[to.month]} ${to.year}`;
  }
  return `${label(from)} ${EN_DASH} ${label(to)}`;
}

function paymentText(booking: BookingContext): string {
  switch (booking.paymentStatus) {
    case 'paid':
      return `Your booking is paid in full (${rupees(booking.amountPaid)}).`;
    case 'part_paid':
      return `You have paid ${rupees(booking.amountPaid)} so far, and ${rupees(booking.amountDue)} is still due.`;
    case 'failed':
      return 'Your last payment attempt did not go through.';
    default:
      return `We have not received a payment for this booking yet (${rupees(booking.amountDue)} due).`;
  }
}

function statusText(status: string): string {
  switch (status) {
    case 'confirmed':
    case 'approved':
      return 'confirmed';
    case 'pending':
      return 'awaiting confirmation';
    case 'completed':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
    default:
      return status;
  }
}

/** Flow variables for a context. Every value is a string, as flow variables are. */
export function contextToVars(
  context: CustomerContext,
  options: { siteUrl?: string } = {}
): Record<string, string> {
  const site = (options.siteUrl ?? DEFAULT_SITE_URL).replace(/\/+$/, '');
  const booking = context.primary;

  const vars: Record<string, string> = {
    customer_first_name: context.customer.firstName ?? 'there',
    customer_name: context.customer.name ?? '',
    has_booking: booking ? 'yes' : 'no',
    booking_count: String(context.bookingCount),
    booking_reference: '',
    booking_title: '',
    booking_slug: '',
    booking_url: '',
    booking_dates: '',
    booking_start: '',
    booking_end: '',
    booking_status: '',
    booking_status_text: '',
    trip_duration: '',
    trip_is_upcoming: '',
    payment_status: '',
    payment_text: '',
    amount_total: '',
    amount_paid: '',
    amount_due: '',
  };
  if (!booking) return vars;

  return {
    ...vars,
    booking_reference: booking.reference,
    booking_title: booking.tourTitle ?? 'your trip',
    booking_slug: booking.tourSlug ?? '',
    booking_url: booking.tourSlug ? `${site}/tours/${booking.tourSlug}` : '',
    booking_dates: formatTripDates(booking.startDate, booking.endDate),
    booking_start: booking.startDate ?? '',
    booking_end: booking.endDate ?? '',
    booking_status: booking.status,
    booking_status_text: statusText(booking.status),
    trip_duration: booking.durationDays ? `${booking.durationDays} days` : '',
    trip_is_upcoming: booking.isUpcoming ? 'yes' : 'no',
    payment_status: booking.paymentStatus,
    payment_text: paymentText(booking),
    amount_total: rupees(booking.totalAmount),
    amount_paid: rupees(booking.amountPaid),
    amount_due: rupees(booking.amountDue),
  };
}

export async function fetchCustomerContext(params: {
  apiBase: string;
  apiKey: string;
  phone: string;
  fetchImpl?: typeof fetch;
  hostGuard?: (host: string) => Promise<boolean>;
  timeoutMs?: number;
  maxBytes?: number;
}): Promise<CustomerContext | null> {
  const {
    apiBase,
    apiKey,
    phone,
    fetchImpl = fetch,
    hostGuard,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
  } = params;

  const digits = phone.replace(/\D/g, '');
  if (!apiKey || !digits) return null;
  const host = hostFromTemplate(apiBase);
  if (!host) return null;
  if (hostGuard && !(await hostGuard(host))) return null;

  const url = `${apiBase.replace(/\/+$/, '')}${LOOKUP_PATH}?phone=${encodeURIComponent(digits)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'x-integration-key': apiKey },
    });
    if (res.status < 200 || res.status > 299) return null;
    const raw = await readCapped(res, maxBytes);
    if (raw === null) return null;
    return parseCustomerContext(JSON.parse(raw));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
