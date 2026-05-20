import {Calendar} from '@campfirein/byterover-packages/components/calendar'
import {endOfDay, startOfDay} from 'date-fns'
import {useEffect, useState} from 'react'

import {formatTimeRangeLabel} from '../utils/time-presets'

type DateRange = {from: Date | undefined; to?: Date}

export interface TaskDateFilterPanelProps {
  createdAfter?: number
  createdBefore?: number
  onChange: (range: {createdAfter?: number; createdBefore?: number}) => void
}

export function TaskDateFilterPanel({createdAfter, createdBefore, onChange}: TaskDateFilterPanelProps) {
  const applied = toDateRange(createdAfter, createdBefore)
  const [selected, setSelected] = useState<DateRange | undefined>(applied)

  useEffect(() => {
    setSelected(toDateRange(createdAfter, createdBefore))
  }, [createdAfter, createdBefore])

  const hasSelection = selected?.from !== undefined && selected?.from !== null
  const hasApplied = createdAfter !== undefined || createdBefore !== undefined
  const isChanged =
    hasSelection &&
    (toMs(selected.from) !== createdAfter || toMs(selected.to ?? selected.from) !== createdBefore)

  const handleApply = () => {
    if (!selected?.from) return
    const from = startOfDay(selected.from).getTime()
    const to = endOfDay(selected.to ?? selected.from).getTime()
    onChange({createdAfter: from, createdBefore: to})
  }

  const handleClear = () => {
    setSelected(undefined)
    onChange({})
  }

  return (
    <div onKeyDown={(event) => event.stopPropagation()}>
      <Calendar
        className="min-w-md bg-transparent p-2"
        mode="range"
        numberOfMonths={2}
        onSelect={setSelected}
        selected={selected}
      />
      <div className="border-border flex items-center justify-between border-t px-3 py-2">
        {hasApplied ? (
          <span className="text-foreground text-xs">{formatTimeRangeLabel({createdAfter, createdBefore})}</span>
        ) : hasSelection ? (
          <span className="text-muted-foreground text-xs">
            {formatTimeRangeLabel({
              createdAfter: toMs(selected.from),
              createdBefore: toMs(selected.to ?? selected.from),
            })}
          </span>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          {hasApplied && (
            <button
              className="text-muted-foreground hover:text-foreground text-xs transition"
              onClick={handleClear}
              type="button"
            >
              Clear
            </button>
          )}
          {hasSelection && isChanged && (
            <button
              className="bg-primary text-foreground rounded px-2.5 py-1 text-xs font-medium"
              onClick={handleApply}
              type="button"
            >
              Apply
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function toDateRange(from?: number, to?: number): DateRange | undefined {
  if (from === undefined) return undefined
  return {from: new Date(from), ...(to === undefined ? {} : {to: new Date(to)})}
}

function toMs(date?: Date): number | undefined {
  return date ? date.getTime() : undefined
}
