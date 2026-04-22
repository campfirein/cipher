import type {ReasoningContentItem, StoredTask, ToolCallEvent} from '../types/stored-task'

export type TimelineEvent =
  | {call: ToolCallEvent; kind: 'toolCall'; timestamp: number}
  | {item: ReasoningContentItem; kind: 'reasoning'; timestamp: number}

export function buildEventTimeline(task: StoredTask): TimelineEvent[] {
  const events: TimelineEvent[] = []
  for (const item of task.reasoningContents ?? []) {
    events.push({item, kind: 'reasoning', timestamp: item.timestamp})
  }

  for (const call of task.toolCalls ?? []) {
    events.push({call, kind: 'toolCall', timestamp: call.timestamp})
  }

  events.sort((a, b) => a.timestamp - b.timestamp)
  return events
}
