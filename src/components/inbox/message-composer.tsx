'use client';

import { useState, useRef, useCallback, useMemo, KeyboardEvent } from 'react';
import { Send, LayoutTemplate } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ReplyQuote } from './reply-quote';
import { CannedReplyPicker } from './canned-reply-picker';
import { useCannedReplies } from '@/hooks/use-canned-replies';
import {
  readSlashQuery,
  renderReply,
  searchReplies,
  type CannedReply,
} from '@/lib/canned-replies';

interface ReplyDraft {
  /** Internal UUID of the message being replied to — sent back through onSend. */
  id: string;
  authorLabel: string;
  preview: string;
}

interface MessageComposerProps {
  conversationId: string;
  sessionExpired: boolean;
  onSend: (text: string, replyToId?: string) => void;
  onOpenTemplates: () => void;
  replyTo?: ReplyDraft | null;
  onClearReply?: () => void;
  /** Tenant of this conversation: scopes which quick replies are offered. */
  tenantId?: string | null;
  /** Used to fill {{name}} and {{phone}} in a quick reply. */
  contactName?: string | null;
  contactPhone?: string | null;
}

export function MessageComposer({
  conversationId,
  sessionExpired,
  onSend,
  onOpenTemplates,
  replyTo,
  onClearReply,
  tenantId,
  contactName,
  contactPhone,
}: MessageComposerProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Quick replies: typing "/" opens a picker over the saved replies.
  const cannedReplies = useCannedReplies(tenantId);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pickerDismissed, setPickerDismissed] = useState(false);
  const slashQuery = readSlashQuery(text);
  const matches = useMemo(
    () => (slashQuery === null ? [] : searchReplies(cannedReplies, slashQuery)),
    [cannedReplies, slashQuery]
  );
  const pickerOpen = !pickerDismissed && matches.length > 0 && !sessionExpired;

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    // Max 4 lines (~96px)
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending || sessionExpired) return;

    setSending(true);
    try {
      onSend(trimmed, replyTo?.id);
      setText('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    } finally {
      setSending(false);
    }
  }, [text, sending, sessionExpired, onSend, replyTo?.id]);

  const pickReply = useCallback(
    (reply: CannedReply) => {
      setText(
        renderReply(reply.body, { name: contactName, phone: contactPhone })
      );
      setPickerDismissed(false);
      setActiveIndex(0);
      // Resize after React has put the inserted text in the box.
      requestAnimationFrame(() => {
        adjustHeight();
        textareaRef.current?.focus();
      });
    },
    [contactName, contactPhone, adjustHeight]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (pickerOpen) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setActiveIndex((i) => (i + 1) % matches.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setActiveIndex((i) => (i - 1 + matches.length) % matches.length);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          pickReply(matches[Math.min(activeIndex, matches.length - 1)]);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setPickerDismissed(true);
          return;
        }
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, pickerOpen, matches, activeIndex, pickReply]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setText(e.target.value);
      setActiveIndex(0);
      setPickerDismissed(false);
      adjustHeight();
    },
    [adjustHeight]
  );

  return (
    <div className="relative border-t border-slate-800 bg-slate-900 p-3">
      {pickerOpen && (
        <CannedReplyPicker
          replies={matches}
          activeIndex={Math.min(activeIndex, matches.length - 1)}
          onPick={pickReply}
          onHover={setActiveIndex}
        />
      )}
      {replyTo && (
        <div className="mb-2">
          <ReplyQuote
            authorLabel={replyTo.authorLabel}
            preview={replyTo.preview}
            onDismiss={onClearReply}
          />
        </div>
      )}
      {sessionExpired && (
        <div className="mb-2 flex items-center justify-between rounded-lg bg-amber-500/10 px-3 py-2">
          <p className="text-xs text-amber-400">
            24-hour session expired. Use a template to re-engage.
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-amber-400 hover:text-amber-300"
            onClick={onOpenTemplates}
          >
            <LayoutTemplate className="mr-1 h-3 w-3" />
            Templates
          </Button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-9 shrink-0 p-0 text-slate-400 hover:text-white"
          onClick={onOpenTemplates}
          title="Send template"
        >
          <LayoutTemplate className="h-4 w-4" />
        </Button>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={
            sessionExpired
              ? 'Session expired - use a template'
              : 'Type a message... (Shift+Enter for new line)'
          }
          disabled={sessionExpired}
          rows={1}
          className={cn(
            'focus:border-primary/50 flex-1 resize-none rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white placeholder-slate-500 transition-colors outline-none',
            sessionExpired && 'cursor-not-allowed opacity-50'
          )}
        />

        <Button
          size="sm"
          className="bg-primary hover:bg-primary/90 h-9 w-9 shrink-0 p-0 disabled:opacity-40"
          disabled={!text.trim() || sessionExpired || sending}
          onClick={handleSend}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>

      {/* Hint sits outside the flex row so its height doesn't push
          `items-end` buttons below the textarea. Indented to line up
          under the textarea left edge (w-9 button + gap-2 = 44px). */}
      <p className="mt-1 pl-11 text-[10px] text-slate-600">
        Type &apos;/&apos; for quick replies
      </p>
    </div>
  );
}
