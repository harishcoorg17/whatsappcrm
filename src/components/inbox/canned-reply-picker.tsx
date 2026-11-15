'use client';

import { cn } from '@/lib/utils';
import type { CannedReply } from '@/lib/canned-replies';

interface CannedReplyPickerProps {
  replies: readonly CannedReply[];
  activeIndex: number;
  onPick: (reply: CannedReply) => void;
  onHover: (index: number) => void;
}

/** The list that appears above the composer after typing "/". */
export function CannedReplyPicker({
  replies,
  activeIndex,
  onPick,
  onHover,
}: CannedReplyPickerProps) {
  return (
    <div
      role="listbox"
      aria-label="Quick replies"
      className="absolute right-3 bottom-full left-3 z-20 mb-2 max-h-64 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-1 shadow-xl"
    >
      {replies.map((reply, index) => (
        <button
          key={reply.id}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          // mousedown so the textarea keeps focus and the click is not lost
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(reply);
          }}
          onMouseEnter={() => onHover(index)}
          className={cn(
            'flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition-colors',
            index === activeIndex ? 'bg-slate-800' : 'hover:bg-slate-800/60'
          )}
        >
          <span className="flex items-center gap-2">
            <span className="text-primary font-mono text-xs">
              /{reply.shortcut}
            </span>
            {reply.title && (
              <span className="truncate text-xs font-medium text-slate-200">
                {reply.title}
              </span>
            )}
          </span>
          <span className="line-clamp-2 text-xs text-slate-400">
            {reply.body}
          </span>
        </button>
      ))}
      <p className="px-3 pt-1 pb-1.5 text-[10px] text-slate-500">
        ↑↓ to choose · Enter to insert · Esc to close
      </p>
    </div>
  );
}
