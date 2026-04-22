import {Badge} from '@campfirein/byterover-packages/components/badge'
import {cn} from '@campfirein/byterover-packages/lib/utils'

import type {TaskListItemStatus} from '../../../../shared/transport/events/task-events'

interface StatusPillProps {
  className?: string
  showLabel?: boolean
  size?: 'md' | 'sm'
  status: TaskListItemStatus
}

interface Presentation {
  /** colored dot bg class */
  dot: string
  label: string
  pulse: boolean
  /** chip bg + border + text colors */
  tone: string
}

const PRESENTATION: Record<TaskListItemStatus, Presentation> = {
  cancelled: {
    dot: 'bg-zinc-500',
    label: 'cancelled',
    pulse: false,
    tone: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-400',
  },
  completed: {
    dot: 'bg-emerald-500',
    label: 'done',
    pulse: false,
    tone: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500',
  },
  created: {
    dot: 'bg-zinc-400',
    label: 'pending',
    pulse: true,
    tone: 'border-zinc-400/30 bg-zinc-400/10 text-zinc-300',
  },
  error: {
    dot: 'bg-red-400',
    label: 'failed',
    pulse: false,
    tone: 'border-red-500/30 bg-red-500/10 text-red-400',
  },
  started: {
    dot: 'bg-blue-400',
    label: 'running',
    pulse: true,
    tone: 'border-blue-500/30 bg-blue-500/10 text-blue-400',
  },
}

export function StatusPill({className, showLabel = true, size = 'sm', status}: StatusPillProps) {
  const {dot, label, pulse, tone} = PRESENTATION[status]
  return (
    <Badge
      className={cn(
        tone,
        size === 'md' ? 'text-xs' : 'text-[11px]',
        'gap-1.5 font-medium tracking-normal',
        status === 'started' && 'shadow-[inset_0_0_6px_rgba(96,165,250,0.2)]',
        className,
      )}
      variant="outline"
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', dot, pulse && 'animate-pill-ping')} />
      {showLabel && <span>{label}</span>}
    </Badge>
  )
}
