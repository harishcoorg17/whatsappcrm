import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultBusinessHours } from './business-hours';

const sendTextMessage = vi.fn();
vi.mock('./meta-api', () => ({
  sendTextMessage: (...args: unknown[]) => sendTextMessage(...args),
}));

import { applyInboundRules } from './inbound-rules';

// Monday 21:00 in Kolkata (closed) and Monday 10:00 (open).
const CLOSED = new Date('2026-11-16T15:30:00Z');
const OPEN = new Date('2026-11-16T04:30:00Z');

interface FakeState {
  rules: Record<string, unknown> | null;
  rulesError: { message: string } | null;
  members: string[];
  openAssignments: string[];
  /** Whether the conditional update finds a row to change. */
  claimSucceeds: boolean;
  updates: Array<{ table: string; values: Record<string, unknown> }>;
  inserts: Array<Record<string, unknown>>;
}

const state: FakeState = {
  rules: null,
  rulesError: null,
  members: [],
  openAssignments: [],
  claimSucceeds: true,
  updates: [],
  inserts: [],
};

function chain(table: string) {
  let op: 'select' | 'update' | 'insert' = 'select';
  const query: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'in', 'neq', 'is', 'or']) {
    query[name] = (..._args: unknown[]) => query;
  }
  query.update = (values: Record<string, unknown>) => {
    op = 'update';
    state.updates.push({ table, values });
    return query;
  };
  query.insert = async (values: Record<string, unknown>) => {
    op = 'insert';
    state.inserts.push(values);
    return { error: null };
  };
  query.maybeSingle = async () =>
    table === 'crm_tenants'
      ? { data: state.rules, error: state.rulesError }
      : { data: null, error: null };
  query.then = (onFulfilled: (v: unknown) => unknown) => {
    let result: unknown = { data: [], error: null };
    if (table === 'crm_tenant_members') {
      result = {
        data: state.members.map((user_id) => ({ user_id })),
        error: null,
      };
    } else if (table === 'conversations' && op === 'select') {
      result = {
        data: state.openAssignments.map((assigned_agent_id) => ({
          assigned_agent_id,
        })),
        error: null,
      };
    } else if (table === 'conversations' && op === 'update') {
      result = { data: state.claimSucceeds ? [{ id: 'c1' }] : [], error: null };
    }
    return Promise.resolve(result).then(onFulfilled);
  };
  return query;
}

const db = {
  from: (table: string) => chain(table),
} as unknown as SupabaseClient;

const closedRules = {
  business_hours: { ...defaultBusinessHours(), enabled: true },
  away_message: 'We are closed, back at 9am',
  auto_assign: false,
};

const base = {
  db,
  tenantId: 't1',
  conversation: { id: 'c1', assigned_agent_id: null, away_sent_at: null },
  contactPhone: '+919000000001',
  accessToken: 'tok',
  phoneNumberId: 'pn1',
  suppressAway: false,
};

beforeEach(() => {
  sendTextMessage.mockReset();
  sendTextMessage.mockResolvedValue({ messageId: 'wamid.away' });
  state.rules = null;
  state.rulesError = null;
  state.members = [];
  state.openAssignments = [];
  state.claimSucceeds = true;
  state.updates = [];
  state.inserts = [];
});

describe('applyInboundRules', () => {
  it('does nothing when the tenant has no rules or the columns are missing', async () => {
    expect(await applyInboundRules({ ...base, now: CLOSED })).toEqual({
      assignedTo: null,
      awaySent: false,
    });
    state.rulesError = { message: 'column does not exist' };
    expect(await applyInboundRules({ ...base, now: CLOSED })).toEqual({
      assignedTo: null,
      awaySent: false,
    });
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it('sends the away message outside business hours and records it', async () => {
    state.rules = closedRules;
    const result = await applyInboundRules({ ...base, now: CLOSED });
    expect(result.awaySent).toBe(true);
    expect(sendTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumberId: 'pn1',
        text: 'We are closed, back at 9am',
      })
    );
    expect(state.inserts[0]).toMatchObject({
      sender_type: 'bot',
      message_id: 'wamid.away',
      conversation_id: 'c1',
    });
    expect(state.updates.some((u) => 'away_sent_at' in u.values)).toBe(true);
  });

  it('stays quiet during business hours', async () => {
    state.rules = closedRules;
    expect((await applyInboundRules({ ...base, now: OPEN })).awaySent).toBe(
      false
    );
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it('stays quiet when a flow is already talking to the customer', async () => {
    state.rules = closedRules;
    expect(
      (await applyInboundRules({ ...base, now: CLOSED, suppressAway: true }))
        .awaySent
    ).toBe(false);
  });

  it('does not send twice when another message already claimed the slot', async () => {
    state.rules = closedRules;
    state.claimSucceeds = false;
    expect((await applyInboundRules({ ...base, now: CLOSED })).awaySent).toBe(
      false
    );
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it('does not send inside the cooldown window', async () => {
    state.rules = closedRules;
    const recent = new Date(CLOSED.getTime() - 60 * 60 * 1000).toISOString();
    const result = await applyInboundRules({
      ...base,
      now: CLOSED,
      conversation: { id: 'c1', assigned_agent_id: null, away_sent_at: recent },
    });
    expect(result.awaySent).toBe(false);
  });

  it('survives a failed send without throwing', async () => {
    state.rules = closedRules;
    sendTextMessage.mockRejectedValue(new Error('Meta down'));
    const result = await applyInboundRules({ ...base, now: CLOSED });
    expect(result.awaySent).toBe(false);
  });

  it('auto-assigns an unassigned chat to the least-busy member', async () => {
    state.rules = {
      business_hours: null,
      away_message: null,
      auto_assign: true,
    };
    state.members = ['busy', 'free'];
    state.openAssignments = ['busy', 'busy', 'busy'];
    const result = await applyInboundRules({ ...base, now: OPEN });
    expect(result.assignedTo).toBe('free');
    expect(state.updates).toContainEqual({
      table: 'conversations',
      values: { assigned_agent_id: 'free' },
    });
  });

  it('leaves an already assigned chat alone and does nothing with no team', async () => {
    state.rules = {
      business_hours: null,
      away_message: null,
      auto_assign: true,
    };
    state.members = ['a'];
    const assigned = await applyInboundRules({
      ...base,
      now: OPEN,
      conversation: {
        id: 'c1',
        assigned_agent_id: 'someone',
        away_sent_at: null,
      },
    });
    expect(assigned.assignedTo).toBeNull();
    state.members = [];
    expect(
      (await applyInboundRules({ ...base, now: OPEN })).assignedTo
    ).toBeNull();
  });

  it('does not report an assignment when the slot was filled meanwhile', async () => {
    state.rules = {
      business_hours: null,
      away_message: null,
      auto_assign: true,
    };
    state.members = ['a'];
    state.claimSucceeds = false;
    expect(
      (await applyInboundRules({ ...base, now: OPEN })).assignedTo
    ).toBeNull();
  });
});
