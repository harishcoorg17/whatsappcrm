import { describe, it, expect } from 'vitest'
import { resolveRoundRobinAgent } from './round-robin'

function fakeDb(members: string[], open: string[]) {
  return {
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      const rows =
        table === 'crm_tenant_members'
          ? members.map((user_id) => ({ user_id }))
          : open.map((assigned_agent_id) => ({ assigned_agent_id }))
      chain.select = () => chain
      chain.eq = () => chain
      chain.in = () => chain
      chain.neq = () => Promise.resolve({ data: rows })
      ;(chain as { then?: unknown }).then = (res: (v: unknown) => void) =>
        res({ data: rows })
      return chain
    },
  }
}

describe('resolveRoundRobinAgent', () => {
  it('falls back to the owner without a tenant', async () => {
    expect(
      await resolveRoundRobinAgent(fakeDb([], []), {
        ownerUserId: 'owner',
        tenantId: null,
      })
    ).toBe('owner')
  })

  it('falls back to the owner when the tenant has no members', async () => {
    expect(
      await resolveRoundRobinAgent(fakeDb([], []), {
        ownerUserId: 'owner',
        tenantId: 't',
      })
    ).toBe('owner')
  })

  it('picks the member with the fewest open chats', async () => {
    const db = fakeDb(['a', 'b'], ['a', 'a', 'b'])
    expect(
      await resolveRoundRobinAgent(db, { ownerUserId: 'owner', tenantId: 't' })
    ).toBe('b')
  })
})
