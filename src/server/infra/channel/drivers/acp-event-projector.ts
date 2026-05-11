import type {TurnEventPayload} from '../../../core/interfaces/channel/i-acp-driver.js'

/**
 * Project an ACP `session/update` notification payload into a payload-only
 * {@link TurnEventPayload} (CHANNEL_PROTOCOL.md §7.1).
 *
 * Returns `undefined` for unrecognised `sessionUpdate` kinds; the caller
 * WARN-logs and drops. Unknown future kinds MUST NOT crash the driver
 * (§13.2 client requirements).
 */
type SessionUpdate = {
  [k: string]: unknown
  sessionUpdate: string
}

const textOf = (block: unknown): string => {
  if (typeof block === 'object' && block !== null && 'text' in block) {
    const t = (block as {text?: unknown}).text
    if (typeof t === 'string') return t
  }

  return ''
}

export const projectSessionUpdate = (update: SessionUpdate): TurnEventPayload | undefined => {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      return {content: textOf(update.content), kind: 'agent_message_chunk'}
    }

    case 'agent_thought_chunk': {
      return {content: textOf(update.content), kind: 'agent_thought_chunk'}
    }

    case 'plan': {
      const entries = Array.isArray(update.entries) ? (update.entries as unknown[]) : []
      return {entries, kind: 'plan'}
    }

    case 'tool_call': {
      const name = typeof update.title === 'string' ? update.title : ''
      return {
        input: update.rawInput,
        kind: 'tool_call',
        name,
        toolCallId: String(update.toolCallId ?? ''),
      }
    }

    case 'tool_call_update': {
      const out: TurnEventPayload = {
        kind: 'tool_call_update',
        toolCallId: String(update.toolCallId ?? ''),
      }
      if (typeof update.status === 'string' && ['completed', 'failed', 'in_progress'].includes(update.status)) {
        ;(out as {status?: string}).status = update.status
      }

      if (update.rawOutput !== undefined) {
        ;(out as {output?: unknown}).output = update.rawOutput
      }

      if (typeof update.error === 'string') {
        ;(out as {error?: string}).error = update.error
      }

      return out
    }

    default: {
      return undefined
    }
  }
}
