import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Credentials {
  phoneNumberId: string;
  accessToken: string;
  wabaId: string | null;
  source: 'tenant' | 'legacy';
}

const state: { credentials: Credentials | null; inserted: unknown[] } = {
  credentials: null,
  inserted: [],
};

const loadCredentials = vi.fn(async () => state.credentials);
vi.mock('./credentials', () => ({
  loadWhatsAppCredentials: (...args: unknown[]) =>
    (loadCredentials as (...a: unknown[]) => unknown)(...args),
}));

import { ParallelBroadcastSender } from './parallel-sender';

const supabase = {
  from: () => {
    const query = {
      update: () => query,
      eq: async () => ({ error: null }),
      insert: async (row: unknown) => {
        state.inserted.push(row);
        return { error: null };
      },
    };
    return query;
  },
} as unknown as SupabaseClient;

const fetchMock = vi.fn();

const RECIPIENTS = [
  { phone: '919876543210', params: [] },
  { phone: '919876543211', params: ['Asha'] },
];

// A fresh Response per call: a body can only be read once.
function metaOk(): Response {
  return new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), {
    status: 200,
  });
}

function sender() {
  return new ParallelBroadcastSender(supabase, {
    delay_between_sends_ms: 1,
    retry_delay_seconds: 0.001,
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  loadCredentials.mockClear();
  state.credentials = null;
  state.inserted = [];
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ParallelBroadcastSender credentials', () => {
  it("sends from the tenant's number with its decrypted token", async () => {
    state.credentials = {
      phoneNumberId: 'pn-amstago',
      accessToken: 'tenant-token',
      wabaId: 'waba-1',
      source: 'tenant',
    };
    fetchMock.mockImplementation(async () => metaOk());

    const result = await sender().sendBroadcast(
      'b1',
      RECIPIENTS,
      'booking_confirmation',
      'en_US',
      'u1'
    );

    expect(result).toMatchObject({ total: 2, successful: 2, failed: 0 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/pn-amstago/messages');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer tenant-token'
    );
  });

  it('looks the credentials up once per broadcast, not once per recipient', async () => {
    state.credentials = {
      phoneNumberId: 'pn-amstago',
      accessToken: 'tenant-token',
      wabaId: null,
      source: 'tenant',
    };
    fetchMock.mockImplementation(async () => metaOk());

    await sender().sendBroadcast('b1', RECIPIENTS, 't', 'en_US', 'u1');

    expect(loadCredentials).toHaveBeenCalledTimes(1);
  });

  it('fails each recipient clearly when nothing is connected', async () => {
    const result = await sender().sendBroadcast(
      'b1',
      RECIPIENTS,
      't',
      'en_US',
      'u1'
    );

    expect(result).toMatchObject({ total: 2, successful: 0, failed: 2 });
    expect(result.results[0].error).toMatch(/config not found/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
