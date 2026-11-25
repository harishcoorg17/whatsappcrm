import type { supabaseAdmin } from '@/lib/flows/admin-client';
import { PARTNER_TYPES, type PartnerType } from './agent-core';
import { tagContactByName } from './lead';

type AdminClient = ReturnType<typeof supabaseAdmin>;

/**
 * Remembers who a non-customer contact is (DMC, hotel, transport vendor) as an
 * ordinary tag on the contact, so later messages are treated the same way
 * without asking the model to work it out again, and the team can filter by it.
 * Never throws: a failed save must not cost the sender a reply.
 */

export const PARTNER_TAG_PREFIX = 'partner-';
const PARTNER_TAG_COLOR = '#6366f1';

export function partnerTagName(type: PartnerType): string {
  return `${PARTNER_TAG_PREFIX}${type}`;
}

/** The partner type for a tag name such as "partner-hotel", else undefined. */
export function partnerTypeFromTag(name: string): PartnerType | undefined {
  if (!name.startsWith(PARTNER_TAG_PREFIX)) return undefined;
  const type = name.slice(PARTNER_TAG_PREFIX.length);
  return (PARTNER_TYPES as readonly string[]).includes(type)
    ? (type as PartnerType)
    : undefined;
}

/** The partner type already saved on this contact, if any. */
export async function loadPartnerType(
  db: AdminClient,
  userId: string,
  contactId: string
): Promise<PartnerType | undefined> {
  try {
    const { data: links } = await db
      .from('contact_tags')
      .select('tag_id')
      .eq('contact_id', contactId);
    const tagIds = ((links ?? []) as Array<{ tag_id: string }>).map(
      (l) => l.tag_id
    );
    if (tagIds.length === 0) return undefined;

    const { data: tags } = await db
      .from('tags')
      .select('name')
      .eq('user_id', userId)
      .in('id', tagIds)
      .like('name', `${PARTNER_TAG_PREFIX}%`);
    for (const tag of (tags ?? []) as Array<{ name: string }>) {
      const type = partnerTypeFromTag(tag.name);
      if (type) return type;
    }
    return undefined;
  } catch (error) {
    console.error(
      '[ai-agent] could not read partner tag:',
      error instanceof Error ? error.message : error
    );
    return undefined;
  }
}

export async function savePartnerType(input: {
  db: AdminClient;
  userId: string;
  tenantId: string;
  contactId: string;
  type: PartnerType;
}): Promise<void> {
  const { db, userId, tenantId, contactId, type } = input;
  try {
    await tagContactByName(db, {
      userId,
      tenantId,
      contactId,
      name: partnerTagName(type),
      color: PARTNER_TAG_COLOR,
    });
  } catch (error) {
    console.error(
      '[ai-agent] could not save partner tag:',
      error instanceof Error ? error.message : error
    );
  }
}
