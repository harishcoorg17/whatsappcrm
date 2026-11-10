import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  evaluateReturningCustomer,
  pickEntryFlow,
  type EntryFlowCandidate,
} from './entry-flow';
import type { CustomerContext } from './customer-context';

function flow(
  id: string,
  trigger_type: EntryFlowCandidate['trigger_type'],
  trigger_config: Record<string, unknown> = {}
): EntryFlowCandidate {
  return { id, trigger_type, trigger_config };
}

const containsKeyword = (text: string, cfg: Record<string, unknown>) =>
  ((cfg.keywords as string[]) ?? []).some((k) =>
    text.toLowerCase().includes(k)
  );

function pick(
  flows: EntryFlowCandidate[],
  options: {
    text?: string;
    isFirstInbound?: boolean;
    returning?: (
      f: EntryFlowCandidate
    ) => Promise<Record<string, string> | null>;
  } = {}
) {
  return pickEntryFlow({
    flows,
    text: options.text ?? 'hello',
    isFirstInbound: options.isFirstInbound ?? false,
    matchesKeyword: containsKeyword,
    resolveReturning: options.returning ?? (async () => null),
  });
}

describe('pickEntryFlow precedence', () => {
  const keywordFlow = flow('kw', 'keyword', { keywords: ['tour'] });
  const returningFlow = flow('ret', 'returning_customer');
  const firstFlow = flow('first', 'first_inbound_message');
  const eligible = async () => ({ customer_first_name: 'Asha' });

  it('lets an explicit keyword win over everything', async () => {
    const result = await pick([returningFlow, firstFlow, keywordFlow], {
      text: 'tour packages please',
      isFirstInbound: true,
      returning: eligible,
    });
    expect(result?.flow.id).toBe('kw');
  });

  it('starts the returning-customer flow, with its variables, when eligible', async () => {
    const result = await pick([firstFlow, returningFlow, keywordFlow], {
      returning: eligible,
    });
    expect(result).toEqual({
      flow: returningFlow,
      initialVars: { customer_first_name: 'Asha' },
    });
  });

  it('prefers the returning-customer flow over the first-message flow', async () => {
    const result = await pick([firstFlow, returningFlow], {
      isFirstInbound: true,
      returning: eligible,
    });
    expect(result?.flow.id).toBe('ret');
  });

  it('falls back to the first-message flow when the customer is not eligible', async () => {
    const result = await pick([returningFlow, firstFlow], {
      isFirstInbound: true,
    });
    expect(result?.flow.id).toBe('first');
    expect(result?.initialVars).toBeUndefined();
  });

  it('does not use the first-message flow for a contact who has messaged before', async () => {
    expect(
      await pick([returningFlow, firstFlow], { isFirstInbound: false })
    ).toBeNull();
  });

  it('returns nothing when no flow applies', async () => {
    expect(await pick([keywordFlow], { text: 'hi' })).toBeNull();
    expect(await pick([])).toBeNull();
  });

  it('ignores manual flows', async () => {
    expect(
      await pick([flow('m', 'manual')], { isFirstInbound: true })
    ).toBeNull();
  });

  it('tries returning-customer flows in order and takes the first eligible', async () => {
    const second = flow('ret2', 'returning_customer');
    const returning = vi.fn(async (f: EntryFlowCandidate) =>
      f.id === 'ret2' ? { x: '1' } : null
    );
    const result = await pick([returningFlow, second], { returning });
    expect(result?.flow.id).toBe('ret2');
    expect(returning).toHaveBeenCalledTimes(2);
  });

  it('does not look the customer up when a keyword already matched', async () => {
    const returning = vi.fn(eligible);
    await pick([keywordFlow, returningFlow], { text: 'tour', returning });
    expect(returning).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------- evaluateReturningCustomer

const NOW = new Date('2026-11-10T12:00:00.000Z');
const HOURS = 3_600_000;

interface FakeState {
  messageTimes: string[];
  phone: string | null;
}
const state: FakeState = { messageTimes: [], phone: '919876543210' };

function fakeDb() {
  return {
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        limit: async () => ({
          data: state.messageTimes.map((created_at) => ({ created_at })),
          error: null,
        }),
        maybeSingle: async () => ({
          data:
            table === 'contacts' && state.phone ? { phone: state.phone } : null,
          error: null,
        }),
      };
      return query;
    },
  } as unknown as SupabaseClient;
}

const CONTEXT: CustomerContext = {
  customer: { id: 'u1', name: 'Asha Rao', firstName: 'Asha' },
  bookingCount: 1,
  primary: {
    reference: 'B1111111',
    status: 'confirmed',
    tourTitle: 'Kerala Hills',
    tourSlug: 'kerala-hills',
    durationDays: 5,
    startDate: '2026-12-14',
    endDate: '2026-12-18',
    totalAmount: 29404,
    amountPaid: 29404,
    amountDue: 0,
    paymentStatus: 'paid',
    isUpcoming: true,
  },
};

const loadConfig = vi.fn();
const fetchContext = vi.fn();

function evaluate(config: Record<string, unknown> = {}) {
  return evaluateReturningCustomer({
    db: fakeDb(),
    config,
    conversationId: 'c1',
    contactId: 'ct1',
    now: NOW,
    deps: { loadConfig, fetchContext },
  });
}

beforeEach(() => {
  state.messageTimes = [];
  state.phone = '919876543210';
  loadConfig.mockReset().mockResolvedValue({
    apiBase: 'https://api.example.com/api',
    apiKey: 'secret',
  });
  fetchContext.mockReset().mockResolvedValue(CONTEXT);
});

describe('evaluateReturningCustomer', () => {
  it('is eligible on a customer’s first ever message, even with no earlier gap', async () => {
    state.messageTimes = [NOW.toISOString()];
    const vars = await evaluate();
    expect(vars).toMatchObject({
      customer_first_name: 'Asha',
      booking_title: 'Kerala Hills',
      has_booking: 'yes',
    });
    expect(fetchContext).toHaveBeenCalledWith(
      expect.objectContaining({
        apiBase: 'https://api.example.com/api',
        apiKey: 'secret',
        phone: '919876543210',
      })
    );
  });

  it('is eligible after the default 12-hour gap', async () => {
    state.messageTimes = [
      NOW.toISOString(),
      new Date(NOW.getTime() - 13 * HOURS).toISOString(),
    ];
    expect(await evaluate()).not.toBeNull();
  });

  it('is not eligible in the middle of a conversation', async () => {
    state.messageTimes = [
      NOW.toISOString(),
      new Date(NOW.getTime() - 2 * HOURS).toISOString(),
    ];
    expect(await evaluate()).toBeNull();
    expect(fetchContext).not.toHaveBeenCalled();
  });

  it('honours a custom gap', async () => {
    state.messageTimes = [
      NOW.toISOString(),
      new Date(NOW.getTime() - 3 * HOURS).toISOString(),
    ];
    expect(await evaluate({ min_gap_hours: 2 })).not.toBeNull();
    expect(await evaluate({ min_gap_hours: 4 })).toBeNull();
  });

  it('is not eligible when the tenant has no API address and key', async () => {
    loadConfig.mockResolvedValue(null);
    expect(await evaluate()).toBeNull();
    expect(fetchContext).not.toHaveBeenCalled();
  });

  it('is not eligible when the contact has no phone number', async () => {
    state.phone = null;
    expect(await evaluate()).toBeNull();
    expect(fetchContext).not.toHaveBeenCalled();
  });

  it('is not eligible when the backend does not know the customer', async () => {
    fetchContext.mockResolvedValue(null);
    expect(await evaluate()).toBeNull();
  });

  it('requires a booking by default', async () => {
    fetchContext.mockResolvedValue({
      ...CONTEXT,
      bookingCount: 0,
      primary: null,
    });
    expect(await evaluate()).toBeNull();
  });

  it('can start for a known customer with no booking when the flow allows it', async () => {
    fetchContext.mockResolvedValue({
      ...CONTEXT,
      bookingCount: 0,
      primary: null,
    });
    expect(await evaluate({ requires_booking: false })).toMatchObject({
      has_booking: 'no',
      customer_first_name: 'Asha',
    });
  });

  it('never throws: a failing lookup just means not eligible', async () => {
    fetchContext.mockRejectedValue(new Error('boom'));
    expect(await evaluate()).toBeNull();
  });
});
