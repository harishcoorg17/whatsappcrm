'use client';

import { Megaphone, ExternalLink } from 'lucide-react';
import { adLabel, referralFromRow } from '@/lib/whatsapp/referral';
import type { Conversation } from '@/types';

/** Ad the chat came from (Click-to-WhatsApp), or null for organic chats. */
export function conversationAd(conversation: Conversation | null | undefined) {
  return referralFromRow(
    conversation as unknown as Record<string, unknown> | null
  );
}

/** Compact pill for the conversation header. */
export function AdSourceBadge({
  conversation,
}: {
  conversation: Conversation | null | undefined;
}) {
  const ad = conversationAd(conversation);
  if (!ad) return null;
  return (
    <span
      title={`Came from ${adLabel(ad)}`}
      className="ml-1 hidden max-w-48 items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 sm:inline-flex dark:text-amber-300"
    >
      <Megaphone className="h-3 w-3 shrink-0" />
      <span className="truncate">{adLabel(ad)}</span>
    </span>
  );
}

/** Detail card for the contact sidebar. */
export function AdSourceCard({
  conversation,
}: {
  conversation: Conversation | null | undefined;
}) {
  const ad = conversationAd(conversation);
  if (!ad) return null;
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 px-1 text-xs font-medium tracking-wider text-slate-500 uppercase">
        <Megaphone className="h-3 w-3" />
        Ad source
      </div>
      <div className="mt-2 overflow-hidden rounded-lg border border-slate-800 bg-slate-950/40">
        {ad.mediaUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ad.mediaUrl}
            alt=""
            className="h-24 w-full object-cover"
            referrerPolicy="no-referrer"
          />
        )}
        <div className="space-y-1 p-3">
          <p className="text-sm font-medium text-slate-200">{adLabel(ad)}</p>
          {ad.body && <p className="text-xs text-slate-400">{ad.body}</p>}
          <p className="text-[10px] text-slate-500">
            {ad.sourceType === 'post' ? 'Post' : 'Ad'} ID {ad.sourceId}
          </p>
          {ad.sourceUrl && (
            <a
              href={ad.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary inline-flex items-center gap-1 text-xs hover:underline"
            >
              View ad <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
