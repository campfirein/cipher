import {Button} from '@campfirein/byterover-packages/components/button'
import {Input} from '@campfirein/byterover-packages/components/input'
import {cn} from '@campfirein/byterover-packages/lib/utils'
import {Plus, Search} from 'lucide-react'

import type {TaskListAvailableModel, TaskListCounts} from '../../../../shared/transport/events/task-events'
import type {ProviderDTO} from '../../../../shared/transport/types/dto'

import {TourPointer} from '../../onboarding/components/tour-pointer'
import {STATUS_FILTERS, type StatusFilter} from '../stores/task-store'
import {type DurationPreset} from '../utils/duration-presets'
import {TaskFilterMenu} from './task-filter-menu'

export const STATUS_LABEL: Record<StatusFilter, string> = {
  all: 'All',
  cancelled: 'Cancelled',
  completed: 'Done',
  failed: 'Failed',
  running: 'Running',
}

export const STATUS_DOT_COLOR: Record<Exclude<StatusFilter, 'all'>, string> = {
  cancelled: 'bg-zinc-500',
  completed: 'bg-emerald-500',
  failed: 'bg-red-400',
  running: 'bg-blue-400',
}

export interface FilterBarProps {
  availableModels: TaskListAvailableModel[]
  availableProviders: string[]
  breakdown: TaskListCounts
  createdAfter?: number
  createdBefore?: number
  durationPreset: DurationPreset
  modelFilter: string[]
  onDurationChange: (preset: DurationPreset) => void
  onModelChange: (next: string[]) => void
  onNewTask: () => void
  onProviderChange: (next: string[]) => void
  onSearchChange: (query: string) => void
  onStatusChange: (filter: StatusFilter) => void
  onTimeRangeChange: (range: {createdAfter?: number; createdBefore?: number}) => void
  onTypeChange: (next: string[]) => void
  providerFilter: string[]
  providers: ProviderDTO[]
  searchQuery: string
  statusFilter: StatusFilter
  tourCue?: string
  typeFilter: string[]
}

export function FilterBar({
  availableModels,
  availableProviders,
  breakdown,
  createdAfter,
  createdBefore,
  durationPreset,
  modelFilter,
  onDurationChange,
  onModelChange,
  onNewTask,
  onProviderChange,
  onSearchChange,
  onStatusChange,
  onTimeRangeChange,
  onTypeChange,
  providerFilter,
  providers,
  searchQuery,
  statusFilter,
  tourCue,
  typeFilter,
}: FilterBarProps) {
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-2">
      {STATUS_FILTERS.map((filter) => {
        const count = breakdown[filter]
        const active = statusFilter === filter
        return (
          <button
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition',
              active
                ? 'bg-muted text-foreground font-medium'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
            key={filter}
            onClick={() => onStatusChange(filter)}
            type="button"
          >
            {filter !== 'all' && (
              <span className={cn('inline-block size-1.5 rounded-full', STATUS_DOT_COLOR[filter])} />
            )}
            <span>{STATUS_LABEL[filter]}</span>
            <span className="text-muted-foreground tabular-nums">{count}</span>
          </button>
        )
      })}

      <div className="ml-auto flex items-center gap-2">
        <TaskFilterMenu
          availableModels={availableModels}
          availableProviders={availableProviders}
          createdAfter={createdAfter}
          createdBefore={createdBefore}
          durationPreset={durationPreset}
          modelFilter={modelFilter}
          onDurationChange={onDurationChange}
          onModelChange={onModelChange}
          onProviderChange={onProviderChange}
          onTimeRangeChange={onTimeRangeChange}
          onTypeChange={onTypeChange}
          providerFilter={providerFilter}
          providers={providers}
          typeFilter={typeFilter}
        />

        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            className="dark:bg-background h-8 min-w-56 pl-8 text-xs border border-border"
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search input or id…"
            type="text"
            value={searchQuery}
          />
        </div>

        <TourPointer active={Boolean(tourCue)} align="end" label={tourCue ?? ''}>
          <Button className="h-8" onClick={onNewTask} size="sm" variant="default">
            <Plus className="size-4" />
            New task
          </Button>
        </TourPointer>
      </div>
    </div>
  )
}
