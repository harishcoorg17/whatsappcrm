import { pickLeastLoadedAgent } from '@/lib/whatsapp/business-hours'

interface Db {
  from: (table: string) => any // eslint-disable-line @typescript-eslint/no-explicit-any
}

/**
 * Pick the team member with the fewest open chats in the conversation's
 * tenant. Falls back to the account owner when the tenant has no members
 * (or the conversation has no tenant), so a solo user keeps working.
 */
export async function resolveRoundRobinAgent(
  db: Db,
  args: { ownerUserId: string; tenantId: string | null }
): Promise<string> {
  if (!args.tenantId) return args.ownerUserId

  const { data: members } = await db
    .from('crm_tenant_members')
    .select('user_id')
    .eq('tenant_id', args.tenantId)
  const agentIds = ((members ?? []) as Array<{ user_id: string }>).map(
    (m) => m.user_id
  )
  if (agentIds.length === 0) return args.ownerUserId

  const { data: open } = await db
    .from('conversations')
    .select('assigned_agent_id')
    .eq('tenant_id', args.tenantId)
    .in('assigned_agent_id', agentIds)
    .neq('status', 'closed')
  const counts: Record<string, number> = {}
  for (const row of (open ?? []) as Array<{ assigned_agent_id: string }>) {
    counts[row.assigned_agent_id] = (counts[row.assigned_agent_id] ?? 0) + 1
  }
  return pickLeastLoadedAgent(agentIds, counts) ?? args.ownerUserId
}
