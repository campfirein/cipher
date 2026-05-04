import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@campfirein/byterover-packages/components/dropdown-menu'
import {SlidersHorizontal} from 'lucide-react'
import {useMemo} from 'react'

import type {TaskListAvailableModel} from '../../../../shared/transport/events/task-events'
import type {ProviderDTO} from '../../../../shared/transport/types/dto'

import {DURATION_PRESETS, type DurationPreset, isDurationPreset} from '../utils/duration-presets'
import {TaskDateFilterPanel} from './task-date-filter-panel'

const TYPE_OPTIONS = [
  {label: 'Curate', value: 'curate'},
  {label: 'Query', value: 'query'},
] as const

export interface TaskFilterMenuProps {
  availableModels: TaskListAvailableModel[]
  availableProviders: string[]
  createdAfter?: number
  createdBefore?: number
  durationPreset: DurationPreset
  modelFilter: string[]
  onDurationChange: (preset: DurationPreset) => void
  onModelChange: (next: string[]) => void
  onProviderChange: (next: string[]) => void
  onTimeRangeChange: (range: {createdAfter?: number; createdBefore?: number}) => void
  onTypeChange: (next: string[]) => void
  providerFilter: string[]
  providers: ProviderDTO[]
  typeFilter: string[]
}

export function TaskFilterMenu({
  availableModels,
  availableProviders,
  createdAfter,
  createdBefore,
  durationPreset,
  modelFilter,
  onDurationChange,
  onModelChange,
  onProviderChange,
  onTimeRangeChange,
  onTypeChange,
  providerFilter,
  providers,
  typeFilter,
}: TaskFilterMenuProps) {
  const providerNames = useMemo(() => new Map(providers.map((p) => [p.id, p.name])), [providers])
  const modelOptions = useMemo(
    () => filterModelOptions(availableModels, providerFilter),
    [availableModels, providerFilter],
  )
  const timeActive = createdAfter !== undefined || createdBefore !== undefined
  const hasActive =
    typeFilter.length > 0 ||
    providerFilter.length > 0 ||
    modelFilter.length > 0 ||
    timeActive ||
    durationPreset !== 'all'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="text-muted-foreground hover:text-foreground hover:bg-muted/60 border-border bg-background relative inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm transition-colors">
        <SlidersHorizontal className="pointer-events-none size-3.5" />
        <span className="pointer-events-none">Filter</span>
        {hasActive && (
          <span className="bg-primary pointer-events-none absolute -top-1 -right-1 size-2 rounded-full" />
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="cursor-pointer">
            <span>
              Type
              {typeFilter.length > 0 && <span className="ml-1">({typeFilter.length})</span>}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-48" sideOffset={8}>
            {TYPE_OPTIONS.map((option) => (
              <DropdownMenuCheckboxItem
                checked={typeFilter.includes(option.value)}
                className="cursor-pointer"
                key={option.value}
                onCheckedChange={() => toggleIn(typeFilter, option.value, onTypeChange)}
              >
                {option.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="cursor-pointer">
            <span>
              Provider
              {providerFilter.length > 0 && <span className="ml-1">({providerFilter.length})</span>}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56" sideOffset={8}>
            {availableProviders.length === 0 ? (
              <div className="text-muted-foreground px-2 py-1.5 text-xs">No providers yet</div>
            ) : (
              availableProviders.map((provider) => (
                <DropdownMenuCheckboxItem
                  checked={providerFilter.includes(provider)}
                  className="cursor-pointer"
                  key={provider}
                  onCheckedChange={() => toggleIn(providerFilter, provider, onProviderChange)}
                >
                  {providerNames.get(provider) ?? provider}
                </DropdownMenuCheckboxItem>
              ))
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="cursor-pointer">
            <span>
              Model
              {modelFilter.length > 0 && <span className="ml-1">({modelFilter.length})</span>}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56" sideOffset={8}>
            {modelOptions.length === 0 ? (
              <div className="text-muted-foreground px-2 py-1.5 text-xs">No models yet</div>
            ) : (
              modelOptions.map((modelId) => (
                <DropdownMenuCheckboxItem
                  checked={modelFilter.includes(modelId)}
                  className="cursor-pointer"
                  key={modelId}
                  onCheckedChange={() => toggleIn(modelFilter, modelId, onModelChange)}
                >
                  {modelId}
                </DropdownMenuCheckboxItem>
              ))
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="cursor-pointer">
            <span>
              Time
              {timeActive && <span className="text-primary ml-1">·</span>}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-fit" sideOffset={8}>
            <TaskDateFilterPanel
              createdAfter={createdAfter}
              createdBefore={createdBefore}
              onChange={onTimeRangeChange}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="cursor-pointer">
            <span>
              Duration
              {durationPreset !== 'all' && <span className="text-primary ml-1">·</span>}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-48" sideOffset={8}>
            <DropdownMenuRadioGroup
              onValueChange={(value) => isDurationPreset(value) && onDurationChange(value)}
              value={durationPreset}
            >
              {DURATION_PRESETS.map((preset) => (
                <DropdownMenuRadioItem className="cursor-pointer" key={preset.value} value={preset.value}>
                  {preset.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function toggleIn(current: string[], value: string, onChange: (next: string[]) => void) {
  onChange(current.includes(value) ? current.filter((v) => v !== value) : [...current, value])
}

function filterModelOptions(available: TaskListAvailableModel[], selectedProviders: string[]): string[] {
  const filtered =
    selectedProviders.length === 0 ? available : available.filter((entry) => selectedProviders.includes(entry.providerId))
  const seen = new Set<string>()
  const options: string[] = []
  for (const entry of filtered) {
    if (seen.has(entry.modelId)) continue
    seen.add(entry.modelId)
    options.push(entry.modelId)
  }

  return options
}
