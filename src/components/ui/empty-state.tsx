import { Inbox } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  title?: string
  description?: string
  icon?: ComponentType<{ className?: string }>
  action?: ReactNode
  className?: string
}

export function EmptyState({
  title = 'Nothing here yet',
  description,
  icon: Icon = Inbox,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-700 bg-slate-900/40 px-4 py-8 text-center',
        className,
      )}
    >
      <div className="flex size-10 items-center justify-center rounded-full bg-slate-800 text-slate-400">
        <Icon className="size-5" />
      </div>
      <p className="text-sm font-medium text-slate-200">{title}</p>
      {description ? <p className="max-w-sm text-xs text-slate-500">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}