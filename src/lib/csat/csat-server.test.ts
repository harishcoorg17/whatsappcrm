import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendList = vi.hoisted(() => vi.fn());
vi.mock('@/lib/flows/meta-send', () => ({
  engineSendInteractiveList: (...args: unknown[]) => sendList(...args),
}));

import { recordCsatReply, requestCsat } from './csat-server';

/** Minimal chainable fake: every builder method returns itself; terminal
 *  calls resolve from `results[table]`. */
function fakeDb(results: Record<string, unknown>) {
  const calls: Array<{ table: string; op: string; arg: unknown }> = [];
  const db = {
    from(table: string) {
      const b: Record<string, unknown> = {};
      const chain = () => b;
      for (const m of ['select', 'eq', 'is']) b[m] = chain;
      b.update = (arg: unknown) => (
        calls.push({ table, op: 'update', arg }),
        b
      );
      b.upsert = (arg: unknown) => (
        calls.push({ table, op: 'upsert', arg }),
        Promise.resolve({ error: null })
      );
      b.maybeSingle = () => Promise.resolve({ data: results[table] ?? null });
      b.then = (res: (v: unknown) => unknown) =>
        Promise.resolve({
          data: results[`${table}:update`] ?? [{ id: 'c1' }],
        }).then(res);
      return b;
    },
  };
  return { db: db as never, calls };
}

beforeEach(() => {
  sendList.mockReset();
});

describe('recordCsatReply', () => {
  it('ignores non-csat replies (returns false)', async () => {
    const { db, calls } = fakeDb({});
    expect(
      await recordCsatReply(db, { conversationId: 'c1', replyId: 'human' })
    ).toBe(false);
    expect(calls).toHaveLength(0);
  });
  it('stores the score when a survey is pending', async () => {
    const { db, calls } = fakeDb({
      conversations: {
        id: 'c1',
        tenant_id: 't1',
        contact_id: 'k1',
        assigned_agent_id: 'a1',
        csat_requested_at: '2026-01-01T00:00:00Z',
      },
    });
    expect(
      await recordCsatReply(db, { conversationId: 'c1', replyId: 'csat_4' })
    ).toBe(true);
    expect(calls[0]).toMatchObject({
      table: 'csat_responses',
      op: 'upsert',
      arg: { score: 4, tenant_id: 't1' },
    });
  });
  it('swallows a stale tap without storing', async () => {
    const { db, calls } = fakeDb({
      conversations: { id: 'c1', tenant_id: 't1', csat_requested_at: null },
    });
    expect(
      await recordCsatReply(db, { conversationId: 'c1', replyId: 'csat_5' })
    ).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe('requestCsat', () => {
  const conv = {
    id: 'c1',
    user_id: 'u1',
    contact_id: 'k1',
    tenant_id: 't1',
    csat_requested_at: null,
  };
  it('does nothing when the tenant has it off', async () => {
    const { db } = fakeDb({
      conversations: conv,
      crm_tenants: { csat_enabled: false },
    });
    expect(await requestCsat(db, 'c1')).toBe('disabled');
    expect(sendList).not.toHaveBeenCalled();
  });
  it('sends the list when on', async () => {
    sendList.mockResolvedValue({ whatsapp_message_id: 'w' });
    const { db } = fakeDb({
      conversations: conv,
      crm_tenants: { csat_enabled: true, csat_message: 'Rate' },
    });
    expect(await requestCsat(db, 'c1')).toBe('sent');
    expect(sendList.mock.calls[0][0]).toMatchObject({
      bodyText: 'Rate',
      conversationId: 'c1',
    });
  });
  it('reports failure instead of throwing', async () => {
    sendList.mockImplementation(async () => {
      throw new Error('boom');
    });
    const { db } = fakeDb({
      conversations: conv,
      crm_tenants: { csat_enabled: true },
    });
    expect(await requestCsat(db, 'c1')).toBe('failed');
  });
});
