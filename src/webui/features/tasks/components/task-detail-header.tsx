import {Button} from '@campfirein/byterover-packages/components/button'
import {Tooltip, TooltipContent, TooltipTrigger} from '@campfirein/byterover-packages/components/tooltip'
import {cn} from '@campfirein/byterover-packages/lib/utils'
import {toast} from 'sonner'

import type {StoredTask} from '../types/stored-task'

import {formatDuration, formatRelative} from '../utils/format-time'
import {displayTaskType, isActiveStatus, isTerminalStatus} from '../utils/task-status'
import {StatusPill} from './status-pill'
import {elapsedMs, Separator} from './task-detail-shared'

const STATUS_VERB: Record<StoredTask['status'], string> = {
  cancelled: 'cancelled',
  completed: 'finished',
  created: 'started',
  error: 'finished',
  started: 'started',
}

export function DetailHeader({now, task}: {now: number; task: StoredTask}) {
  const isTerminal = isTerminalStatus(task.status)
  const elapsed = elapsedMs(task, now)
  const referenceTime = task.startedAt ?? task.createdAt
  const verb = STATUS_VERB[task.status]
  const elapsedLabel = isTerminal ? 'ran' : 'running'

  return (
    <header className="px-6 pt-5 pb-4">
      <div className="flex items-center gap-3 pr-12">
        <StatusPill status={task.status} />
        <h1 className="text-foreground min-w-0 flex-1 truncate text-lg leading-tight font-medium tracking-tight">
          {task.content || <span className="text-muted-foreground italic">(empty)</span>}
        </h1>
      </div>
      <div className="text-muted-foreground mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <CopyableTaskId taskId={task.taskId} />
        <Separator />
        <span className="mono uppercase tracking-wider">{displayTaskType(task.type)}</span>
        <Separator />
        <span>
          {verb} {formatRelative(referenceTime, now)} ago
        </span>
        <Separator />
        <span
          className={cn('mono tabular-nums', isActiveStatus(task.status) ? 'text-blue-400' : 'text-muted-foreground')}
        >
          {elapsedLabel} {formatDuration(elapsed)}
        </span>
      </div>
    </header>
  )
}

function CopyableTaskId({taskId}: {taskId: string}) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(taskId)
      toast.success('Task ID copied', {duration: 2000})
    } catch {
      toast.error('Failed to copy task ID', {duration: 3000})
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label="Copy task ID"
            className="text-identifier hover:text-identifier hover:bg-identifier/10 mono px-1.5 font-normal"
            onClick={copy}
            size="xs"
            variant="ghost"
          />
        }
      >
        <span className="truncate">{taskId}</span>
      </TooltipTrigger>
      <TooltipContent>Click to copy</TooltipContent>
    </Tooltip>
  )
}
