import type {ComponentRef} from 'react'

import {useStickToBottom} from '../hooks/use-stick-to-bottom'
import {useTickingNow} from '../hooks/use-ticking-now'
import {useTaskById} from '../stores/task-store'
import {isActiveStatus} from '../utils/task-status'
import {EventLogSection} from './task-detail-event-log'
import {DetailHeader} from './task-detail-header'
import {ErrorSection, InputSection, LiveStreamSection, NotFound, ResultSection} from './task-detail-sections'

interface TaskDetailViewProps {
  taskId: string
}

// eslint-disable-next-line complexity
export function TaskDetailView({taskId}: TaskDetailViewProps) {
  const task = useTaskById(taskId)
  const isActive = task ? isActiveStatus(task.status) : false
  const now = useTickingNow(isActive)

  const lastReasoning = task?.reasoningContents?.at(-1)
  const {onScroll, ref: scrollRef} = useStickToBottom<ComponentRef<'div'>>(
    [
      task?.toolCalls?.length ?? 0,
      task?.reasoningContents?.length ?? 0,
      lastReasoning?.content?.length ?? 0,
      task?.streamingContent?.length ?? 0,
      task?.responseContent,
      task?.result,
      task?.error?.message,
    ],
    isActive,
  )

  if (!task) {
    return <NotFound taskId={taskId} />
  }

  // Live and Result are mutually exclusive (TUI convention).
  const showLive = isActive && (task.streamingContent || task.responseContent)
  const result = task.status === 'completed' ? task.result : undefined
  const error = task.status === 'error' ? task.error : undefined

  return (
    <div className="flex h-full min-h-0 flex-col">
      <DetailHeader now={now} task={task} />
      <div className="border-border/50 border-t" />
      <div className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto px-6 py-5" onScroll={onScroll} ref={scrollRef}>
        <InputSection task={task} />
        {task.type !== 'query' && <EventLogSection now={now} task={task} />}
        {showLive && <LiveStreamSection task={task} />}
        {result && <ResultSection content={result} />}
        {error && <ErrorSection error={error} />}
      </div>
    </div>
  )
}
