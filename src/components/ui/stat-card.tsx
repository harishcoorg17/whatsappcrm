import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import type { ComponentType } from 'react'
import { cn } from '@/lib/utils'

interface StatCardProps {
  label: string
  value: string
  icon?: ComponentType<{ className?: string }>
  delta?: { sign: number; label: string }
  hint?: string
  className?: string
}

export function StatCard({ label, value, icon: Icon, delta, hint, className }: StatCardProps) {
  return (
    <div className={cn('glass-card-hover group relative overflow-hidden p-5', className)}>
      <div className="bg-primary/10 group-hover:bg-primary/20 absolute -top-4 -right-4 size-20 rounded-full blur-2xl transition-all" />
      <div className="relative flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-slate-400">{label}</p>
        {Icon ? (
          <div className="flex size-9 items-center justify-center rounded-xl border border-slate-700/60 bg-slate-800/80 text-primary shadow-inner transition-transform group-hover:scale-110">
            <Icon className="size-4" />
          </div>
        ) : null}
      </div>
      <p className="relative mt-4 text-3xl leading-none font-extrabold tracking-tight text-white tabular-nums">
        {value}
      </p>
      {delta ? <DeltaRow sign={delta.sign} label={delta.label} /> : hint ? (
        <p className="relative mt-2.5 text-xs font-medium text-slate-400">{hint}</p>
      ) : null}
    </div>
  )
}

function DeltaRow({ sign, label }: { sign: number; label: string }) {
  const tone = sign > 0 ? 'text-primary' : sign < 0 ? 'text-red-400' : 'text-slate-500'
  const Arrow = sign > 0 ? ArrowUp : sign < 0 ? ArrowDown : Minus
  return (
    <div className={cn('relative mt-2 flex items-center gap-1 text-sm', tone)}>
      <Arrow className="size-4" aria-hidden />
      <span className="tabular-nums">{label}</span>
    </div>
  )
}