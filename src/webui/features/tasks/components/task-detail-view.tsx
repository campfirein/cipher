import type {ComponentRef} from 'react'

import {TourTaskBanner, TourTaskContinueCta} from '../../onboarding/components/tour-task-banner'
import {useOnboardingStore} from '../../onboarding/stores/onboarding-store'
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

  const tourTaskId = useOnboardingStore((s) => s.tourTaskId)
  const isTourTask = tourTaskId === taskId

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
      // Include status so the active → terminal transition (which is when the
      // Result/Error sections + tour Continue CTA appear) re-runs the effect
      // and snaps the user to the new bottom if they were already there.
      task?.status,
    ],
    // Stay enabled for the tour task even after it terminates, so the final
    // scroll picks up the Continue CTA at the bottom of the detail.
    isActive || isTourTask,
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
        <TourTaskBanner task={task} />
        <InputSection task={task} />
        <EventLogSection now={now} task={task} />
        {showLive && <LiveStreamSection task={task} />}
        {result && <ResultSection content={result} />}
        {error && <ErrorSection error={error} />}
        <TourTaskContinueCta task={task} />
      </div>
    </div>
  )
}
