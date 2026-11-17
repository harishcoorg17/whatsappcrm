import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { claimDueBroadcasts, releaseBroadcastClaim } from './claim';

function rpcClient(result: { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn(async () => result);
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe('claimDueBroadcasts', () => {
  it('calls the atomic claim function with default limit and lease', async () => {
    const { client, rpc } = rpcClient({ data: [{ id: 'b1' }], error: null });
    const claimed = await claimDueBroadcasts(client);
    expect(claimed).toEqual([{ id: 'b1' }]);
    expect(rpc).toHaveBeenCalledWith('claim_due_broadcasts', {
      p_limit: 3,
      p_lease_seconds: 120,
    });
  });

  it('returns an empty list when nothing is due', async () => {
    const { client } = rpcClient({ data: null, error: null });
    expect(await claimDueBroadcasts(client)).toEqual([]);
  });

  it('throws on a database error so the cron run reports failure', async () => {
    const { client } = rpcClient({ data: null, error: { message: 'boom' } });
    await expect(claimDueBroadcasts(client)).rejects.toThrow('boom');
  });

  it('two overlapping runs receive disjoint broadcasts (DB lock semantics)', async () => {
    // Model of claim_due_broadcasts: each call atomically takes unclaimed rows.
    const due = ['b1', 'b2', 'b3', 'b4'];
    const rpc = vi.fn(async (_fn: string, args: { p_limit: number }) => ({
      data: due.splice(0, args.p_limit).map((id) => ({ id })),
      error: null,
    }));
    const client = { rpc } as unknown as SupabaseClient;
    const [a, b] = await Promise.all([
      claimDueBroadcasts(client, { limit: 3 }),
      claimDueBroadcasts(client, { limit: 3 }),
    ]);
    const ids = [...a, ...b].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(4);
  });
});

describe('releaseBroadcastClaim', () => {
  it('expires the lease only for a broadcast that is still sending', async () => {
    const calls: Array<[string, unknown]> = [];
    const chain = {
      update: (v: unknown) => (calls.push(['update', v]), chain),
      eq: (c: string, v: unknown) => (calls.push([`eq:${c}`, v]), chain),
      then: (res: (v: { error: null }) => void) => res({ error: null }),
    };
    const client = { from: () => chain } as unknown as SupabaseClient;
    await releaseBroadcastClaim(client, 'b1');
    expect(calls).toContainEqual(['eq:id', 'b1']);
    expect(calls).toContainEqual(['eq:status', 'sending']);
  });
});
