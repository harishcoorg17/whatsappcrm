import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { canActOnConversation } from './conversation-access';

function clientWithRpc(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe('canActOnConversation', () => {
  it('allows the owner without a membership lookup', async () => {
    const { client, rpc } = clientWithRpc({ data: false, error: null });

    const allowed = await canActOnConversation(client, 'user-1', {
      user_id: 'user-1',
      tenant_id: 'tenant-1',
    });

    expect(allowed).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('allows a member of the conversation tenant', async () => {
    const { client, rpc } = clientWithRpc({ data: true, error: null });

    const allowed = await canActOnConversation(client, 'agent-1', {
      user_id: 'owner-1',
      tenant_id: 'tenant-1',
    });

    expect(allowed).toBe(true);
    expect(rpc).toHaveBeenCalledWith('is_tenant_member', {
      p_tenant_id: 'tenant-1',
    });
  });

  it('refuses a platform admin who is neither owner nor member', async () => {
    const { client } = clientWithRpc({ data: false, error: null });

    const allowed = await canActOnConversation(client, 'admin-1', {
      user_id: 'owner-1',
      tenant_id: 'tenant-1',
    });

    expect(allowed).toBe(false);
  });

  it('refuses when the conversation has no tenant and the caller is not the owner', async () => {
    const { client, rpc } = clientWithRpc({ data: true, error: null });

    const allowed = await canActOnConversation(client, 'admin-1', {
      user_id: 'owner-1',
      tenant_id: null,
    });

    expect(allowed).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses when the membership check fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = clientWithRpc({
      data: null,
      error: { message: 'function does not exist' },
    });

    const allowed = await canActOnConversation(client, 'agent-1', {
      user_id: 'owner-1',
      tenant_id: 'tenant-1',
    });

    expect(allowed).toBe(false);
    spy.mockRestore();
  });
});
