import type {ReactNode} from 'react'

import {Tooltip, TooltipContent, TooltipTrigger} from '@campfirein/byterover-packages/components/tooltip'
import {cn} from '@campfirein/byterover-packages/lib/utils'
import {Check, X} from 'lucide-react'

import type {StoredTask} from '../types/stored-task'

export function Separator() {
  return (
    <span aria-hidden className="text-muted-foreground/40">
      ·
    </span>
  )
}

export function SectionLabel({children, count}: {children: ReactNode; count?: number | string}) {
  return (
    <div className="text-muted-foreground mono mb-3 flex items-baseline gap-2 text-[11px] uppercase tracking-wider">
      <span>{children}</span>
      <span className="bg-border/50 h-px flex-1" />
      {count !== undefined && <span className="tabular-nums">{count}</span>}
    </div>
  )
}

export type EventTone = 'completed' | 'error' | 'muted' | 'running'

const DOT_BG: Record<EventTone, string> = {
  completed: 'bg-emerald-500',
  error: 'bg-red-400',
  muted: 'bg-muted-foreground/60',
  running: 'bg-blue-400',
}

export const RAIL_BG: Record<EventTone, string> = {
  completed: 'bg-emerald-500/70',
  error: 'bg-red-400/70',
  muted: 'bg-muted-foreground/30',
  running: 'rail-running',
}

export function EventDot({flash, tone, tooltip}: {flash?: boolean; tone: EventTone; tooltip?: ReactNode}) {
  const dot = (
    <span className="absolute top-1 left-0 grid size-3 place-items-center">
      <span
        className={cn(
          'ring-background relative z-10 size-2 rounded-full ring-[1.5px]',
          DOT_BG[tone],
          flash && 'animate-dot-flash',
        )}
      />
      {tone === 'running' && (
        <span className="bg-blue-400 absolute inset-0 rounded-full opacity-50 animate-dot-pulse" />
      )}
    </span>
  )

  if (!tooltip) return dot

  return (
    <Tooltip>
      <TooltipTrigger render={dot} />
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}

export function TerminalDot({tone}: {tone: 'completed' | 'error'}) {
  const Icon = tone === 'completed' ? Check : X
  const bg = tone === 'completed' ? 'bg-emerald-500' : 'bg-red-400'
  return (
    <span className="absolute -top-0.5 -left-1 grid size-5 place-items-center">
      <span className={cn('ring-background relative grid size-4 place-items-center rounded-full ring-2', bg)}>
        <Icon className="text-background absolute size-3 stroke-3" />
      </span>
    </span>
  )
}

export function elapsedMs(task: StoredTask, now: number): number {
  const start = task.startedAt ?? task.createdAt
  const end = task.completedAt ?? now
  return Math.max(0, end - start)
}
