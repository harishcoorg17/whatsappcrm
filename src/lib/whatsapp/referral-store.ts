import type { SupabaseClient } from '@supabase/supabase-js';
import { adTagName, parseReferral, referralToColumns } from './referral';

export interface PersistReferralInput {
  db: SupabaseClient;
  userId: string;
  contactId: string;
  conversationId: string;
  /** Raw `referral` object from the Meta webhook message. */
  rawReferral: unknown;
}

const AD_TAG_COLOR = '#f59e0b';

/**
 * Store a Click-to-WhatsApp referral on the conversation (first touch wins: a
 * chat already attributed to an ad keeps it) and tag the contact "Ad: <name>"
 * so tenants can segment and route on it. Never throws; the customer's message
 * must not depend on attribution.
 */
export async function persistAdReferral(
  input: PersistReferralInput
): Promise<boolean> {
  const ad = parseReferral(input.rawReferral);
  if (!ad) return false;
  try {
    const { data, error } = await input.db
      .from('conversations')
      .update(referralToColumns(ad))
      .eq('id', input.conversationId)
      .is('ad_source_id', null)
      .select('id');
    if (error) {
      // 42703 = migration 042 not applied yet; attribution is simply off.
      console.error('[referral] store failed:', error.message);
      return false;
    }
    if (!data || data.length === 0) return false; // already attributed

    const name = adTagName(ad);
    const { data: existing } = await input.db
      .from('tags')
      .select('id')
      .eq('user_id', input.userId)
      .eq('name', name)
      .maybeSingle();
    let tagId: string | null = existing?.id ?? null;
    if (!tagId) {
      const { data: created } = await input.db
        .from('tags')
        .insert({ user_id: input.userId, name, color: AD_TAG_COLOR })
        .select('id')
        .single();
      tagId = created?.id ?? null;
    }
    if (tagId) {
      await input.db
        .from('contact_tags')
        .upsert(
          { contact_id: input.contactId, tag_id: tagId },
          { onConflict: 'contact_id,tag_id', ignoreDuplicates: true }
        );
    }
    return true;
  } catch (err) {
    console.error('[referral] unexpected error:', err);
    return false;
  }
}
