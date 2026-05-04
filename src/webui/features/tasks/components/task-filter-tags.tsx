import {Tag} from '@campfirein/byterover-packages/components/tag/tag'
import {X} from 'lucide-react'
import {useMemo} from 'react'

import type {ProviderDTO} from '../../../../shared/transport/types/dto'
import type {StatusFilter} from '../stores/task-store'
import type {DurationPreset} from '../utils/duration-presets'

import {durationPresetLabel} from '../utils/duration-presets'
import {formatTimeRangeLabel} from '../utils/time-presets'
import {STATUS_LABEL} from './task-list-filter-bar'

const TYPE_LABEL: Record<string, string> = {
  curate: 'Curate',
  query: 'Query',
}

export interface TaskFilterTagsProps {
  createdAfter?: number
  createdBefore?: number
  durationPreset: DurationPreset
  modelFilter: string[]
  onClearAll: () => void
  onDurationChange: (preset: DurationPreset) => void
  onModelChange: (next: string[]) => void
  onProviderChange: (next: string[]) => void
  onSearchChange: (query: string) => void
  onStatusChange: (filter: StatusFilter) => void
  onTimeRangeChange: (range: {createdAfter?: number; createdBefore?: number}) => void
  onTypeChange: (next: string[]) => void
  providerFilter: string[]
  providers: ProviderDTO[]
  searchQuery: string
  statusFilter: StatusFilter
  typeFilter: string[]
}

export function TaskFilterTags({
  createdAfter,
  createdBefore,
  durationPreset,
  modelFilter,
  onClearAll,
  onDurationChange,
  onModelChange,
  onProviderChange,
  onSearchChange,
  onStatusChange,
  onTimeRangeChange,
  onTypeChange,
  providerFilter,
  providers,
  searchQuery,
  statusFilter,
  typeFilter,
}: TaskFilterTagsProps) {
  const providerNames = useMemo(() => new Map(providers.map((p) => [p.id, p.name])), [providers])

  const tags = useMemo(() => {
    const result: Array<{key: string; label: string; onRemove: () => void}> = []

    if (statusFilter !== 'all') {
      result.push({
        key: `status:${statusFilter}`,
        label: `Status: ${STATUS_LABEL[statusFilter]}`,
        onRemove: () => onStatusChange('all'),
      })
    }

    for (const value of typeFilter) {
      result.push({
        key: `type:${value}`,
        label: `Type: ${TYPE_LABEL[value] ?? value}`,
        onRemove: () => onTypeChange(typeFilter.filter((v) => v !== value)),
      })
    }

    for (const value of providerFilter) {
      result.push({
        key: `provider:${value}`,
        label: `Provider: ${providerNames.get(value) ?? value}`,
        onRemove: () => onProviderChange(providerFilter.filter((v) => v !== value)),
      })
    }

    for (const value of modelFilter) {
      result.push({
        key: `model:${value}`,
        label: `Model: ${value}`,
        onRemove: () => onModelChange(modelFilter.filter((v) => v !== value)),
      })
    }

    if (createdAfter !== undefined || createdBefore !== undefined) {
      result.push({
        key: 'time',
        label: `Time: ${formatTimeRangeLabel({createdAfter, createdBefore})}`,
        onRemove: () => onTimeRangeChange({}),
      })
    }

    if (durationPreset !== 'all') {
      result.push({
        key: `duration:${durationPreset}`,
        label: `Duration: ${durationPresetLabel(durationPreset)}`,
        onRemove: () => onDurationChange('all'),
      })
    }

    if (searchQuery.trim()) {
      result.push({
        key: 'search',
        label: `“${searchQuery.trim()}”`,
        onRemove: () => onSearchChange(''),
      })
    }

    return result
  }, [
    statusFilter,
    typeFilter,
    providerFilter,
    modelFilter,
    createdAfter,
    createdBefore,
    durationPreset,
    searchQuery,
    providerNames,
    onStatusChange,
    onTypeChange,
    onProviderChange,
    onModelChange,
    onTimeRangeChange,
    onDurationChange,
    onSearchChange,
  ])

  if (tags.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-1">
      {tags.map((tag) => (
        <Tag closable key={tag.key} onClose={tag.onRemove} variant="secondary">
          {tag.label}
        </Tag>
      ))}
      <button
        className="text-muted-foreground hover:text-foreground inline-flex cursor-pointer items-center gap-1 px-1.5 py-0.5 text-xs transition"
        onClick={onClearAll}
        type="button"
      >
        <X className="size-3" />
        Clear filters
      </button>
    </div>
  )
}
