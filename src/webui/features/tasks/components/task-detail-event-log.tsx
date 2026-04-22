import {cn} from '@campfirein/byterover-packages/lib/utils'
import {type ReactNode, useEffect, useMemo, useRef} from 'react'

import type {ReasoningContentItem, StoredTask} from '../types/stored-task'

import {buildEventTimeline, type TimelineEvent} from '../utils/build-event-timeline'
import {formatTimeOfDay} from '../utils/format-time'
import {formatToolArgs} from '../utils/format-tool-args'
import {isActiveStatus, isTerminalStatus} from '../utils/task-status'
import {MarkdownInline} from './markdown-inline'
import {EventDot, type EventTone, RAIL_BG, SectionLabel} from './task-detail-shared'
import {ToolCallContent} from './task-detail-tool-call'

const ACTIVE_VERB: Record<string, string> = {
  curate: 'Curating',
  'curate-folder': 'Curating',
  query: 'Querying',
}

function eventKey(event: TimelineEvent, index: number): string {
  return `${event.kind}-${index}-${event.timestamp}`
}

function eventTone(event: TimelineEvent): EventTone {
  if (event.kind === 'reasoning') return 'muted'
  if (event.call.status === 'error') return 'error'
  if (event.call.status === 'running') return 'running'
  return 'completed'
}

export function EventLogSection({now, task}: {now: number; task: StoredTask}) {
  const events = useMemo(() => buildEventTimeline(task), [task])
  const isActive = isActiveStatus(task.status)
  const seenRef = useRef<null | Set<string>>(null)
  const prevToneRef = useRef<Map<string, EventTone>>(new Map())

  // First render — seed with all current events so initial paint doesn't stagger.
  // Only events that arrive *after* mount will animate in.
  if (seenRef.current === null) {
    seenRef.current = new Set(events.map((e, i) => eventKey(e, i)))
  }

  const newKeys: string[] = []
  const flashKeys = new Set<string>()
  for (const [i, event] of events.entries()) {
    const key = eventKey(event, i)
    if (!seenRef.current.has(key)) newKeys.push(key)
    const tone = eventTone(event)
    const prev = prevToneRef.current.get(key)
    if (prev === 'running' && (tone === 'completed' || tone === 'error')) {
      flashKeys.add(key)
    }
  }

  useEffect(() => {
    if (!seenRef.current) return
    for (const [i, event] of events.entries()) {
      const key = eventKey(event, i)
      seenRef.current.add(key)
      prevToneRef.current.set(key, eventTone(event))
    }
  })

  if (events.length === 0) {
    return (
      <section>
        <SectionLabel>Event log</SectionLabel>
        {isActive ? (
          <ol className="space-y-5">
            <ActiveFooterRow taskType={task.type} />
          </ol>
        ) : (
          <p className="text-muted-foreground text-center text-sm py-6">No events captured for this task.</p>
        )}
      </section>
    )
  }

  return (
    <section>
      <SectionLabel count={events.length}>Event log</SectionLabel>
      <ol className="space-y-5">
        {events.map((event, i) => {
          const key = eventKey(event, i)
          const newIndex = newKeys.indexOf(key)
          const isLast = i === events.length - 1
          const hasResult = task.status === 'completed' && Boolean(task.result)
          const hasError = task.status === 'error' && Boolean(task.error)
          const hasTerminalSection = hasResult || hasError
          // Rail extends past the last event when something follows below:
          // active footer, Result section, or Error section.
          const hasNext = !isLast || isActive || hasTerminalSection
          const endTimestamp = events[i + 1]?.timestamp ?? task.completedAt ?? now
          // Rail tone for the last event matches what's below it so the visual
          // story continues without a color seam.
          let railTone: EventTone = eventTone(event)
          if (isLast) {
            if (isActive) railTone = 'running'
            else if (hasResult) railTone = 'completed'
            else if (hasError) railTone = 'error'
          }

          return (
            <EventRow
              endTimestamp={endTimestamp}
              event={event}
              flash={flashKeys.has(key)}
              hasNext={hasNext}
              isNew={newIndex !== -1}
              key={key}
              railTone={railTone}
              staggerIndex={Math.max(newIndex, 0)}
              taskId={task.taskId}
              taskTerminal={isTerminalStatus(task.status)}
              tooltip={buildTooltip(event, endTimestamp)}
            />
          )
        })}
        {isActive && <ActiveFooterRow taskType={task.type} />}
      </ol>
    </section>
  )
}

function ActiveFooterRow({taskType}: {taskType: string}) {
  const verb = ACTIVE_VERB[taskType] ?? 'Working'
  return (
    <li className="relative pl-7">
      <EventDot tone="running" />
      <span className="bg-blue-400/70 absolute top-[9px] left-[13px] h-px w-5.5 rounded" />
      <span className="text-blue-400/70 mono absolute top-[2px] left-10 text-[9px] uppercase tracking-wider">now</span>
      <span className="text-blue-400 italic text-sm ml-10">{verb}…</span>
    </li>
  )
}

function EventRow({
  endTimestamp,
  event,
  flash,
  hasNext,
  isNew,
  railTone,
  staggerIndex,
  taskId,
  taskTerminal,
  tooltip,
}: {
  endTimestamp: number
  event: TimelineEvent
  flash: boolean
  hasNext: boolean
  isNew: boolean
  railTone: EventTone
  staggerIndex: number
  taskId: string
  taskTerminal: boolean
  tooltip: ReactNode
}) {
  return (
    <li
      className={cn('relative pl-7', isNew && 'animate-in fade-in slide-in-from-bottom-1 duration-300 fill-mode-both')}
      style={isNew ? {animationDelay: `${staggerIndex * 60}ms`} : undefined}
    >
      {hasNext && <div className={cn('absolute top-3 -bottom-7 left-[5px] w-0.5 rounded-full', RAIL_BG[railTone])} />}
      {event.kind === 'reasoning' ? (
        <ReasoningContent
          endTimestamp={endTimestamp}
          flash={flash}
          hasNext={hasNext}
          item={event.item}
          taskTerminal={taskTerminal}
          tooltip={tooltip}
        />
      ) : (
        <ToolCallContent call={event.call} flash={flash} taskId={taskId} tooltip={tooltip} />
      )}
    </li>
  )
}

function buildTooltip(event: TimelineEvent, endTimestamp: number): ReactNode {
  const time = formatTimeOfDay(event.timestamp)
  const duration = formatShortDuration(endTimestamp - event.timestamp)
  if (event.kind === 'reasoning') {
    return (
      <span className="flex flex-col gap-0.5">
        <span>
          <span className="mono text-muted-foreground tabular-nums">{time}</span>
          <span className="mono text-blue-400 ml-2 tabular-nums">+{duration}</span>
        </span>
        <span className="mono text-foreground/80 text-[10px]">reasoning</span>
      </span>
    )
  }

  const summary = formatToolArgs(event.call).slice(0, 60)
  return (
    <span className="flex flex-col gap-0.5">
      <span>
        <span className="mono text-muted-foreground tabular-nums">{time}</span>
        <span className="mono text-blue-400 ml-2 tabular-nums">+{duration}</span>
      </span>
      <span className="mono text-foreground/80 text-[10px] wrap-break-word">
        {event.call.toolName}
        {summary && ` · ${summary}`}
      </span>
    </span>
  )
}

function formatShortDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`
  const sec = ms / 1000
  if (sec < 60) return `${sec.toFixed(sec < 10 ? 1 : 0)}s`
  return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`
}

function ReasoningContent({
  endTimestamp,
  flash,
  hasNext,
  item,
  taskTerminal,
  tooltip,
}: {
  endTimestamp: number
  flash: boolean
  hasNext: boolean
  item: ReasoningContentItem
  taskTerminal: boolean
  tooltip: ReactNode
}) {
  const stillThinking = (item.isThinking || !item.content) && !taskTerminal && !hasNext
  const thoughtFor = stillThinking ? undefined : formatThoughtDuration(endTimestamp - item.timestamp)
  return (
    <>
      <EventDot flash={flash} tone="muted" tooltip={tooltip} />
      <div className="text-muted-foreground mb-1.5 flex items-baseline gap-2 text-[11px]">
        <span className="mono uppercase tracking-wider">reasoning</span>
        {stillThinking ? (
          <span className="text-blue-400/80 inline-flex items-center gap-1.5 italic">
            <span className="bg-blue-400 size-1 rounded-full animate-pulse" />
            thinking…
          </span>
        ) : (
          thoughtFor && <span className="italic">Thought for {thoughtFor}</span>
        )}
      </div>
      {item.content && <MarkdownInline className="text-foreground/90 text-sm">{item.content}</MarkdownInline>}
    </>
  )
}

function formatThoughtDuration(ms: number): string {
  const sec = Math.max(1, Math.round(ms / 1000))
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const remSec = sec % 60
  return remSec > 0 ? `${min}m ${remSec}s` : `${min}m`
}
