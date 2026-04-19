/**
 * Pure helpers that translate llmservice events into stored-task mutations.
 * Kept separate from the zustand store so the logic is unit-testable without
 * standing the store up.
 */

import type {ReasoningContentItem, StoredTask, ToolCallEvent} from '../types/stored-task'

export function addToolCallTo(task: StoredTask, incoming: ToolCallEvent): StoredTask {
  const existing = task.toolCalls ?? []
  const index = incoming.callId ? existing.findIndex((tc) => tc.callId === incoming.callId) : -1

  if (index >= 0) {
    const current = existing[index]
    const hasNewArgs = incoming.args && Object.keys(incoming.args).length > 0
    const updated = [...existing]
    updated[index] = {
      ...current,
      args: hasNewArgs ? incoming.args : current.args,
      sessionId: incoming.sessionId,
    }
    return {...task, sessionId: incoming.sessionId, toolCalls: updated}
  }

  return {
    ...task,
    sessionId: incoming.sessionId,
    toolCalls: [...existing, incoming],
  }
}

interface UpdateToolCallResultParams {
  callId: string | undefined
  error?: string
  errorType?: string
  result?: unknown
  success: boolean
  toolName: string
}

export function updateToolCallResultIn(task: StoredTask, params: UpdateToolCallResultParams): StoredTask {
  const calls = task.toolCalls ?? []
  if (calls.length === 0) return task

  let index = -1
  if (params.callId) {
    index = calls.findIndex((tc) => tc.callId === params.callId)
  }

  if (index === -1 && params.toolName) {
    for (let i = calls.length - 1; i >= 0; i--) {
      if (calls[i].toolName === params.toolName && calls[i].status === 'running') {
        index = i
        break
      }
    }
  }

  if (index === -1) return task

  const updated = [...calls]
  updated[index] = {
    ...updated[index],
    error: params.error,
    errorType: params.errorType,
    result: params.result,
    status: params.success ? 'completed' : 'error',
  }

  return {...task, toolCalls: updated}
}

export function addReasoningContentTo(task: StoredTask, item: ReasoningContentItem): StoredTask {
  const existing = task.reasoningContents ?? []
  const last = existing.at(-1)
  if (item.isThinking && last?.isThinking) return task

  return {
    ...task,
    reasoningContents: [...existing, item],
  }
}

interface AppendStreamingParams {
  content: string
  isComplete: boolean
  sessionId?: string
  type: 'reasoning' | 'text'
}

export function appendStreamingContentTo(task: StoredTask, params: AppendStreamingParams): StoredTask {
  if (params.type === 'reasoning') {
    const existing = task.reasoningContents ?? []
    const lastIndex = existing.length - 1
    const last = existing[lastIndex]
    if (last) {
      const updated = [...existing]
      updated[lastIndex] = {
        ...last,
        content: last.content + params.content,
        isThinking: false,
      }
      return {
        ...task,
        isStreaming: !params.isComplete,
        reasoningContents: updated,
        sessionId: params.sessionId ?? task.sessionId,
      }
    }

    return {
      ...task,
      isStreaming: !params.isComplete,
      reasoningContents: [{content: params.content, isThinking: false, timestamp: Date.now()}],
      sessionId: params.sessionId ?? task.sessionId,
    }
  }

  return {
    ...task,
    isStreaming: !params.isComplete,
    sessionId: params.sessionId ?? task.sessionId,
    streamingContent: (task.streamingContent ?? '') + params.content,
  }
}

export function setResponseOn(task: StoredTask, params: {content: string; sessionId?: string}): StoredTask {
  return {
    ...task,
    isStreaming: false,
    responseContent: params.content,
    sessionId: params.sessionId ?? task.sessionId,
    streamingContent: undefined,
  }
}
