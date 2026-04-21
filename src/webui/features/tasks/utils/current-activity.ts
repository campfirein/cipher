/**
 * Surfaces what a running task is doing right now:
 *   - a tool call in flight,
 *   - the most recent reasoning content (if any has arrived),
 *   - or `'thinking'` if the agent has begun but emitted nothing yet.
 *
 * Returns `null` for non-active tasks so callers can render nothing.
 */

import type {StoredTask} from '../types/stored-task'

import {formatToolArgs} from './format-tool-args'
import {isActiveStatus} from './task-status'

export type CurrentActivity =
  | 'thinking'
  | {arg: string; kind: 'tool'; tool: string}
  | {kind: 'reasoning'; text: string}

const REASONING_PREVIEW_LEN = 80

export function getCurrentActivity(task: StoredTask): CurrentActivity | null {
  if (!isActiveStatus(task.status)) return null

  const lastTool = task.toolCalls?.at(-1)
  const lastReasoning = task.reasoningContents?.at(-1)
  const toolTime = lastTool?.timestamp ?? 0
  const reasoningTime = lastReasoning?.timestamp ?? 0

  // Whichever event has the more recent timestamp wins. Tool calls regardless
  // of status (running/completed/error) — fast tools transition out of
  // 'running' before we can render, so gating on status hides them entirely.
  if (lastTool && toolTime >= reasoningTime) {
    return {arg: formatToolArgs(lastTool), kind: 'tool', tool: lastTool.toolName}
  }

  // Reasoning is shown if it's the latest event AND has content. We ignore
  // the `isThinking` flag (mirrors the detail event log workaround): some
  // models stream reasoning text without ever flipping the flag, so trusting
  // it leaves us stuck on 'thinking…' forever.
  if (lastReasoning && lastReasoning.content.trim()) {
    const trimmed = lastReasoning.content.trim().replaceAll(/\s+/g, ' ')
    return {kind: 'reasoning', text: trimmed.slice(0, REASONING_PREVIEW_LEN)}
  }

  return 'thinking'
}
