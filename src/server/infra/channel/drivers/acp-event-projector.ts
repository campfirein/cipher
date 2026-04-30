import type {SessionNotification} from '@agentclientprotocol/sdk'

import {createHash} from 'node:crypto'
import {statSync} from 'node:fs'

import type {TurnEvent} from '../../../core/domain/channel/types.js'

export interface ProjectorContext {
  /** Stable salt for placeholder content hashes when planned text is unavailable. */
  turnId: string
}

/**
 * Projects ACP `session/update` chunks into Phase-1-schema `TurnEvent`s
 * (`core/domain/channel/types.ts:99-143`). Field shapes here are exact —
 * the projector tests round-trip every emitted event through `TurnEvent.parse`
 * to guard against drift.
 *
 * Coverage decisions:
 *  - `agent_message_chunk` (text) → `kind: 'token'` per chunk. The orchestrator
 *    reconstructs `message.md` from the joined deltas; no separate `message`-kind
 *    event is emitted in v1.
 *  - `agent_thought_chunk`, `plan`, `available_commands_update` → silently dropped.
 *    Phase 3's TUI can revisit when a "thoughts" pane exists.
 *  - `tool_call` → `kind: 'status', status: 'tool'` plus, for `kind: 'edit'`
 *    locations, a `kind: 'artifact_intent'` carrying `path` + deterministic
 *    `contentHash`.
 *  - `tool_call_update` → `kind: 'tool'` with `ok` derived from `status`; on
 *    completed edit, additionally a `kind: 'artifact'` with `bytes` from disk.
 */
export class AcpEventProjector {
  private readonly toolStarts = new Map<string, {name: string; startedAt: number}>()

  public constructor(private readonly ctx: ProjectorContext) {}

   
  public *project(update: SessionNotification['update']): Generator<TurnEvent> {
    switch (update.sessionUpdate) {
      case 'agent_message_chunk': {
        if (update.content.type === 'text') {
          yield {delta: update.content.text, kind: 'token'}
        }

        return
      }

      case 'tool_call': {
        const name = update.title ?? update.kind ?? 'tool'
        this.toolStarts.set(update.toolCallId, {name, startedAt: Date.now()})
        yield {kind: 'status', status: 'tool'}
        const path = pickEditPath(update)
        if (path) {
          const planned = pickPlannedContent(update)
          const contentHash = sha256(planned ?? `${this.ctx.turnId}:${update.toolCallId}`)
          yield (planned === undefined ? {contentHash, kind: 'artifact_intent', path} : {bytesEstimate: Buffer.byteLength(planned), contentHash, kind: 'artifact_intent', path});
        }

        return
      }

      case 'tool_call_update': {
        const start = this.toolStarts.get(update.toolCallId)
        if (!start) return
        if (update.status === 'completed') {
          const latencyMs = Date.now() - start.startedAt
          yield {kind: 'tool', latencyMs, name: start.name, ok: true}
          const path = pickEditPath(update)
          if (path) {
            const bytes = safeFileBytes(path)
            const summary = update.title ? update.title.slice(0, 200) : undefined
            yield (summary === undefined ? {bytes, kind: 'artifact', path} : {bytes, kind: 'artifact', path, summary});
          }

          this.toolStarts.delete(update.toolCallId)
          return
        }

        if (update.status === 'failed') {
          const latencyMs = Date.now() - start.startedAt
          yield {kind: 'tool', latencyMs, name: start.name, ok: false}
          const message = pickFailureMessage(update)
          yield {kind: 'error', message}
          this.toolStarts.delete(update.toolCallId)
        }

        // 'pending'/'in_progress' updates are no-ops; we only emit on terminal status.
        
      }

      // agent_thought_chunk / plan / available_commands_update — silently dropped in v1.
      // No default branch; unhandled kinds simply emit nothing.
    }
  }
}

function pickEditPath(update: unknown): string | undefined {
  if (typeof update !== 'object' || update === null) return undefined
  const u = update as {kind?: string; locations?: Array<{path?: string}>}
  if (u.kind !== 'edit') return undefined
  return u.locations?.[0]?.path
}

function pickPlannedContent(update: unknown): string | undefined {
  if (typeof update !== 'object' || update === null) return undefined
  const u = update as {rawInput?: {content?: unknown}}
  const content = u.rawInput?.content
  return typeof content === 'string' ? content : undefined
}

function pickFailureMessage(update: unknown): string {
  if (typeof update !== 'object' || update === null) return 'tool failed'
  const u = update as {error?: {message?: unknown}}
  return typeof u.error?.message === 'string' ? u.error.message : 'tool failed'
}

function safeFileBytes(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}
