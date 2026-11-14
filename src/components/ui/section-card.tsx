import type { ReactNode } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface SectionCardProps {
  title?: string
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
}

export function SectionCard({
  title,
  description,
  action,
  children,
  className,
  contentClassName,
}: SectionCardProps) {
  return (
    <Card className={cn('glass-card gap-0 py-0 ring-0', className)}>
      {title || description || action ? (
        <CardHeader className="flex-row items-center justify-between gap-3 border-b border-slate-700/60 py-4">
          <div>
            {title ? <CardTitle>{title}</CardTitle> : null}
            {description ? <CardDescription className="mt-0.5">{description}</CardDescription> : null}
          </div>
          {action}
        </CardHeader>
      ) : null}
      <CardContent className={cn('p-4', contentClassName)}>{children}</CardContent>
    </Card>
  )
}