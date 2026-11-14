import type { ComponentType } from 'react'
import { EmptyState as EmptyStatePrimitive } from '@/components/ui/empty-state'

export function EmptyState({
  title,
  hint,
  icon,
  className,
}: {
  title?: string
  hint?: string
  icon?: ComponentType<{ className?: string }>
  className?: string
}) {
  return <EmptyStatePrimitive title={title} description={hint} icon={icon} className={className} />
}