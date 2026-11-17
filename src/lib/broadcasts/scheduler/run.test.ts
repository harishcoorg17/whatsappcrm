import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const loadCreds = vi.fn();
vi.mock('@/lib/whatsapp/credentials', () => ({
  loadWhatsAppCredentials: (...a: unknown[]) => loadCreds(...a),
}));
const filterOptOut = vi.fn();
vi.mock('@/lib/whatsapp/consent', () => ({
  filterOptedOutRecipients: (...a: unknown[]) => filterOptOut(...a),
}));

import { finalStatus, runScheduledBroadcasts, OPTED_OUT_ERROR } from './run';

interface Rec {
  id: string;
  status: string;
  error?: string;
  messageId?: string;
  contact: { id: string; phone: string | null };
}

/** Minimal in-memory stand-in for the tables the runner touches. */
function makeDb(opts: { claimed: unknown[]; recipients: Rec[] }) {
  const broadcastUpdates: Array<Record<string, unknown>> = [];
  const recipients = opts.recipients;

  function recipientQuery() {
    const filters: Record<string, unknown> = {};
    let mode: 'select' | 'update' = 'select';
    let patch: Record<string, unknown> = {};
    let head = false;
    let limit = Infinity;
    const q: Record<string, unknown> = {
      select: (_c: string, o?: { head?: boolean }) => ((head = Boolean(o?.head)), q),
      update: (p: Record<string, unknown>) => ((mode = 'update'), (patch = p), q),
      eq: (c: string, v: unknown) => ((filters[c] = v), q),
      order: () => q,
      limit: (n: number) => ((limit = n), q),
      then: (resolve: (v: unknown) => void) => {
        const rows = recipients.filter((r) =>
          'status' in filters ? r.status === filters.status : true
        );
        if (mode === 'update') {
          const target = recipients.filter((r) =>
            'id' in filters
              ? r.id === filters.id
              : r.status === 'pending'
          );
          for (const r of target) {
            r.status = patch.status as string;
            r.error = patch.error_message as string | undefined;
            r.messageId = patch.whatsapp_message_id as string | undefined;
          }
          return resolve({ error: null });
        }
        if (head) return resolve({ count: rows.length, error: null });
        return resolve({
          data: rows.slice(0, limit).map((r) => ({ id: r.id, contact: r.contact })),
          error: null,
        });
      },
    };
    return q;
  }

  const db = {
    rpc: async () => ({ data: opts.claimed, error: null }),
    from: (table: string) => {
      if (table === 'broadcast_recipients') return recipientQuery();
      if (table === 'broadcasts') {
        const q: Record<string, unknown> = {
          update: (p: Record<string, unknown>) => (broadcastUpdates.push(p), q),
          eq: () => q,
          then: (res: (v: unknown) => void) => res({ error: null }),
        };
        return q;
      }
      // message_templates / contact_custom_values
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        in: () => q,
        maybeSingle: async () => ({ data: null }),
        then: (res: (v: unknown) => void) => res({ data: [], error: null }),
      };
      return q;
    },
  } as unknown as SupabaseClient;

  return { db, broadcastUpdates, recipients };
}

const broadcast = {
  id: 'b1',
  user_id: 'u1',
  name: 'Sale',
  template_name: 'promo',
  template_language: 'en_US',
  template_variables: {},
};
const rec = (id: string, phone: string | null = '+919999900000'): Rec => ({
  id,
  status: 'pending',
  contact: { id: `c-${id}`, phone },
});

beforeEach(() => {
  loadCreds.mockResolvedValue({ phoneNumberId: 'p1', accessToken: 't' });
  filterOptOut.mockImplementation(async (_db, _u, rs: unknown[]) => ({
    allowed: rs,
    skipped: [],
  }));
});

describe('finalStatus', () => {
  it('is failed only when every recipient failed', () => {
    expect(finalStatus(3, 3)).toBe('failed');
    expect(finalStatus(3, 2)).toBe('sent');
    expect(finalStatus(0, 0)).toBe('sent');
  });
});

describe('runScheduledBroadcasts', () => {
  it('does nothing when no broadcast is due', async () => {
    const { db } = makeDb({ claimed: [], recipients: [] });
    const send = vi.fn();
    const summary = await runScheduledBroadcasts({ db, send, sleep: async () => {} });
    expect(summary).toEqual({ claimed: 0, outcomes: [] });
    expect(send).not.toHaveBeenCalled();
  });

  it('sends every pending recipient then marks the broadcast sent', async () => {
    const { db, broadcastUpdates, recipients } = makeDb({
      claimed: [broadcast],
      recipients: Array.from({ length: 12 }, (_, i) => rec(`r${i}`)),
    });
    const send = vi.fn(async () => ({ ok: true as const, messageId: 'wamid' }));
    const summary = await runScheduledBroadcasts({ db, send, sleep: async () => {} });

    expect(send).toHaveBeenCalledTimes(12); // 2 batches of 10 + 2
    expect(recipients.every((r) => r.status === 'sent')).toBe(true);
    expect(summary.outcomes).toEqual([{ id: 'b1', outcome: 'completed' }]);
    expect(broadcastUpdates.at(-1)).toMatchObject({ status: 'sent', claimed_until: null });
  });

  it('marks the broadcast failed when every send fails', async () => {
    const { db, broadcastUpdates } = makeDb({
      claimed: [broadcast],
      recipients: [rec('r1'), rec('r2')],
    });
    const send = vi.fn(async () => ({ ok: false as const, error: 'nope' }));
    const summary = await runScheduledBroadcasts({ db, send, sleep: async () => {} });
    expect(summary.outcomes[0].outcome).toBe('failed');
    expect(broadcastUpdates.at(-1)).toMatchObject({ status: 'failed' });
  });

  it('skips opted-out contacts and never sends to them', async () => {
    filterOptOut.mockImplementation(async (_d, _u, rs: Array<{ id: string }>) => ({
      allowed: rs.filter((r) => r.id !== 'r1'),
      skipped: rs.filter((r) => r.id === 'r1'),
    }));
    const { db, recipients } = makeDb({
      claimed: [broadcast],
      recipients: [rec('r1'), rec('r2')],
    });
    const send = vi.fn(async () => ({ ok: true as const, messageId: 'w' }));
    await runScheduledBroadcasts({ db, send, sleep: async () => {} });
    expect(send).toHaveBeenCalledTimes(1);
    expect(recipients.find((r) => r.id === 'r1')).toMatchObject({
      status: 'failed',
      error: OPTED_OUT_ERROR,
    });
  });

  it('fails a recipient with no phone without calling Meta', async () => {
    const { db, recipients } = makeDb({
      claimed: [broadcast],
      recipients: [rec('r1', null), rec('r2')],
    });
    const send = vi.fn(async () => ({ ok: true as const, messageId: 'w' }));
    await runScheduledBroadcasts({ db, send, sleep: async () => {} });
    expect(send).toHaveBeenCalledTimes(1);
    expect(recipients[0].status).toBe('failed');
  });

  it('pauses (lease released) when the time budget runs out mid-audience', async () => {
    const { db, broadcastUpdates, recipients } = makeDb({
      claimed: [broadcast],
      recipients: Array.from({ length: 25 }, (_, i) => rec(`r${i}`)),
    });
    let clock = 0;
    const send = vi.fn(async () => ({ ok: true as const, messageId: 'w' }));
    const summary = await runScheduledBroadcasts({
      db,
      send,
      now: () => clock,
      sleep: async () => {
        clock += 30_000; // each batch + pause burns 30s of the 45s budget
      },
    });
    expect(summary.outcomes).toEqual([{ id: 'b1', outcome: 'paused' }]);
    expect(recipients.some((r) => r.status === 'pending')).toBe(true);
    expect(broadcastUpdates.some((u) => u.status === 'sent')).toBe(false);
    expect(broadcastUpdates.at(-1)).toHaveProperty('claimed_until');
  });

  it('fails the broadcast cleanly when WhatsApp is not configured', async () => {
    loadCreds.mockResolvedValue(null);
    const { db, broadcastUpdates, recipients } = makeDb({
      claimed: [broadcast],
      recipients: [rec('r1')],
    });
    const send = vi.fn();
    const summary = await runScheduledBroadcasts({ db, send, sleep: async () => {} });
    expect(send).not.toHaveBeenCalled();
    expect(recipients[0]).toMatchObject({ status: 'failed', error: 'WhatsApp not configured' });
    expect(summary.outcomes[0].outcome).toBe('failed');
    expect(broadcastUpdates.at(-1)).toMatchObject({ status: 'failed' });
  });
});
