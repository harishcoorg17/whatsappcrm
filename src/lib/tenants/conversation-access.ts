import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Who may ACT on a conversation (send, react, survey), as opposed to merely
 * see it. Platform admins can read every tenant's chats (migration 057), so
 * "row level security let me load it" is no longer proof of the right to
 * speak as that tenant. Only the owner or a member of the conversation's
 * tenant may.
 */

export interface ConversationOwnership {
  user_id: string | null;
  tenant_id?: string | null;
}

export async function canActOnConversation(
  supabase: SupabaseClient,
  userId: string,
  conversation: ConversationOwnership
): Promise<boolean> {
  if (conversation.user_id === userId) return true;
  if (!conversation.tenant_id) return false;
  const { data, error } = await supabase.rpc('is_tenant_member', {
    p_tenant_id: conversation.tenant_id,
  });
  if (error) {
    console.error(
      '[conversation-access] membership check failed:',
      error.message
    );
    return false;
  }
  return data === true;
}
