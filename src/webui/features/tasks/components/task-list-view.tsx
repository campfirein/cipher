import {Button} from '@campfirein/byterover-packages/components/button'
import {Sheet, SheetContent} from '@campfirein/byterover-packages/components/sheet'
import {useEffect, useMemo, useState} from 'react'
import {useSearchParams} from 'react-router-dom'

import type {ComposerType} from './task-composer-types'

import {useTransportStore} from '../../../stores/transport-store'
import {CURATE_EXAMPLE, QUERY_EXAMPLE, TOUR_STEP_LABEL} from '../../onboarding/lib/tour-examples'
import {useOnboardingStore} from '../../onboarding/stores/onboarding-store'
import {useGetTasks} from '../api/get-tasks'
import {useTickingNow} from '../hooks/use-ticking-now'
import {useComposerRetryStore} from '../stores/composer-retry-store'
import {statusMatchesFilter, taskMatchesQuery, useStatusBreakdown, useTaskStore} from '../stores/task-store'
import {isTerminalStatus} from '../utils/task-status'
import {TaskComposerSheet} from './task-composer'
import {TaskDetailView} from './task-detail-view'
import {BulkActionsBar} from './task-list-bulk-actions'
import {EmptyState, LoadingState, PlaceholderCard} from './task-list-empty'
import {FilterBar} from './task-list-filter-bar'
import {TaskTable} from './task-list-table'

export function TaskListView() {
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedTaskId = searchParams.get('task') ?? undefined
  const openTask = (taskId: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('task', taskId)
      return next
    })
  }

  const closeTask = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('task')
      return next
    })
  }

  const projectPath = useTransportStore((s) => s.selectedProject)

  const tasks = useTaskStore((s) => s.tasks)
  const statusFilter = useTaskStore((s) => s.statusFilter)
  const setStatusFilter = useTaskStore((s) => s.setStatusFilter)
  const searchQuery = useTaskStore((s) => s.searchQuery)
  const setSearchQuery = useTaskStore((s) => s.setSearchQuery)
  const clearCompleted = useTaskStore((s) => s.clearCompleted)
  const removeTask = useTaskStore((s) => s.removeTask)

  const breakdown = useStatusBreakdown()
  const {isLoading} = useGetTasks({projectPath: projectPath || undefined})
  const now = useTickingNow(breakdown.running > 0)

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [composer, setComposer] = useState<{
    initialContent?: string
    initialType?: ComposerType
    open: boolean
  }>({open: false})

  const tourActive = useOnboardingStore((s) => s.tourActive)
  const tourStep = useOnboardingStore((s) => s.tourStep)
  const tourTaskId = useOnboardingStore((s) => s.tourTaskId)
  const setTourTaskId = useOnboardingStore((s) => s.setTourTaskId)
  const inComposerStep = tourStep === 'curate' || tourStep === 'query'
  const inTour = tourActive && inComposerStep
  const tourCueLabel =
    inTour && !tourTaskId
      ? tourStep === 'curate'
        ? 'Click to capture knowledge'
        : 'Click to ask a question'
      : undefined

  const openComposer = () => {
    if (inTour) {
      const example = tourStep === 'curate' ? CURATE_EXAMPLE : QUERY_EXAMPLE
      setComposer({initialContent: example, initialType: tourStep, open: true})
      return
    }

    setComposer({open: true})
  }

  const closeComposer = () => setComposer({open: false})

  // Pick up retry seeds from the task-detail "Try again" CTA. Both normal and
  // tour mode use this composer now, so the seed flow is shared.
  const retrySeed = useComposerRetryStore((s) => s.seed)
  const consumeRetry = useComposerRetryStore((s) => s.consume)

  useEffect(() => {
    if (!retrySeed) return
    setComposer({initialContent: retrySeed.content, initialType: retrySeed.type, open: true})
    closeTask()
    consumeRetry()
  }, [retrySeed, consumeRetry, closeTask])

  const onComposerSubmitted = (taskId: string, openDetail: boolean) => {
    if (inTour) setTourTaskId(taskId)
    if (openDetail) openTask(taskId)
  }

  // O(1) taskId → task lookup. Replaces repeated tasks.find() in bulk action paths.
  const taskMap = useMemo(() => new Map(tasks.map((task) => [task.taskId, task])), [tasks])

  const filtered = useMemo(
    () =>
      tasks
        .filter((task) => statusMatchesFilter(task.status, statusFilter))
        .filter((task) => taskMatchesQuery(task, searchQuery))
        .sort((a, b) => {
          const aActive = isTerminalStatus(a.status) ? 1 : 0
          const bActive = isTerminalStatus(b.status) ? 1 : 0
          if (aActive !== bActive) return aActive - bActive
          const aRef = a.completedAt ?? a.startedAt ?? a.createdAt
          const bRef = b.completedAt ?? b.startedAt ?? b.createdAt
          return bRef - aRef
        }),
    [tasks, statusFilter, searchQuery],
  )

  const allFilteredSelected = filtered.length > 0 && filtered.every((task) => selectedIds.has(task.taskId))
  const someSelected = selectedIds.size > 0
  const finishedCount = breakdown.completed + breakdown.failed + breakdown.cancelled

  const canBulkDelete = useMemo(() => {
    for (const id of selectedIds) {
      const task = taskMap.get(id)
      if (task && isTerminalStatus(task.status)) return true
    }

    return false
  }, [selectedIds, taskMap])

  const toggleSelect = (taskId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      if (allFilteredSelected) return new Set()
      const next = new Set(prev)
      for (const task of filtered) next.add(task.taskId)
      return next
    })
  }

  const clearSelection = () => setSelectedIds(new Set())

  const deleteSelected = () => {
    for (const taskId of selectedIds) {
      const task = taskMap.get(taskId)
      if (task && isTerminalStatus(task.status)) removeTask(taskId)
    }

    clearSelection()
  }

  return (
    <div className="mx-auto flex h-full w-full min-h-0 max-w-7xl flex-col gap-3">
      {someSelected ? (
        <BulkActionsBar
          canDelete={canBulkDelete}
          count={selectedIds.size}
          onClear={clearSelection}
          onDelete={deleteSelected}
        />
      ) : (
        <FilterBar
          breakdown={breakdown}
          onNewTask={openComposer}
          onSearchChange={setSearchQuery}
          onStatusChange={(filter) => {
            setStatusFilter(filter)
            clearSelection()
          }}
          searchQuery={searchQuery}
          statusFilter={statusFilter}
          // Coachmark moves between the empty-state CTA and the header CTA so
          // we never highlight both simultaneously.
          tourCue={tourCueLabel && tasks.length > 0 ? tourCueLabel : undefined}
        />
      )}

      {isLoading ? (
        <PlaceholderCard>
          <LoadingState />
        </PlaceholderCard>
      ) : tasks.length === 0 ? (
        <PlaceholderCard withDots>
          <EmptyState onNewTask={openComposer} tourCue={tourCueLabel} />
        </PlaceholderCard>
      ) : (
        <TaskTable
          allSelected={allFilteredSelected}
          filtered={filtered}
          now={now}
          onClearSearch={() => setSearchQuery('')}
          onDelete={removeTask}
          onRowClick={openTask}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
          searchQuery={searchQuery}
          selectedIds={selectedIds}
          statusFilter={statusFilter}
        />
      )}

      {finishedCount > 0 && (
        <div className="flex items-center justify-end px-1">
          <Button onClick={() => clearCompleted()} size="xs" variant="ghost">
            Clear finished ({finishedCount})
          </Button>
        </div>
      )}

      <Sheet onOpenChange={(open) => !open && closeTask()} open={Boolean(selectedTaskId)}>
        <SheetContent
          className="data-[side=right]:w-full data-[side=right]:max-w-3xl p-0 shadow-[inset_1px_0_0_rgba(96,165,250,0.18)]"
          side="right"
        >
          {selectedTaskId && <TaskDetailView taskId={selectedTaskId} />}
        </SheetContent>
      </Sheet>

      <TaskComposerSheet
        initialContent={composer.initialContent}
        initialType={composer.initialType}
        onClose={closeComposer}
        onSubmitted={onComposerSubmitted}
        open={composer.open}
        prefillNotice={inTour ? 'example' : undefined}
        tourStepLabel={inTour ? TOUR_STEP_LABEL[tourStep] : undefined}
      />
    </div>
  )
}
