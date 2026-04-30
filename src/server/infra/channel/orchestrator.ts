import type {
  ChannelMember,
  ChannelMeta,
  Turn,
  TurnEvent,
} from '../../core/domain/channel/types.js'
import type {ChannelAgentDriver} from './drivers/types.js'
import type {LookbackBuilder} from './storage/lookback-builder.js'
import type {TreeReader} from './storage/tree-reader.js'
import type {TreeWriter} from './storage/tree-writer.js'
import type {WriteSerializer} from './storage/write-serializer.js'

import {AgentNotAvailableError, ChannelNotFoundError, PermissionDeniedError, PermissionExpiredError, TurnCancelledError} from '../../core/domain/channel/errors.js'
import {transition} from '../../core/domain/channel/state-machine.js'

export interface TurnEventNotification {
  channelId: string
  event: TurnEvent
  turnId: string
  type: 'turn-event'
}

export interface DriverContext {
  channelId: string
  projectRoot: string
}

export interface ActiveTurnTracker {
  bind(channelId: string, turnId: string, driver: ChannelAgentDriver, agentId?: string): void
  unbind(channelId: string, turnId: string): void
}

export interface OrchestratorDeps {
  /** Optional. When provided, the orchestrator binds/unbinds drivers around `prompt()` so cancels can find them. */
  activeTurnTracker?: ActiveTurnTracker
  driverFor(agentId: string, ctx?: DriverContext): ChannelAgentDriver
  lookbackBuilder: LookbackBuilder
  /** In-process broadcast hook. Phase 3 hooks the cross-process subscription transport here (BRV-221). */
  publish(channelId: string, ev: TurnEventNotification): void
  reader: TreeReader
  serializer: WriteSerializer
  writer: TreeWriter
}

export interface MentionInput {
  channelId: string
  prompt: string
}

const MAX_PARALLEL_AGENTS = 4

/**
 * Channel turn router (BRV-203).
 *
 * `mention()` parses `@<agent>` references, reserves turn IDs atomically,
 * and runs each mentioned agent's turn in parallel through the FSM. The
 * v1 concurrency model is mention-parallel (per design §3.5) with a hard
 * ceiling of {@link MAX_PARALLEL_AGENTS} concurrent turns per prompt.
 *
 * `recoverChannelsOnStartup()` (Q4) walks every channel on daemon start,
 * transitions any in-flight turn to `failed` with reason `daemon_restarted`,
 * appends a transcript-continuity error event, and resets affected member
 * statuses from `thinking` / `awaiting_permission` to `errored`.
 */
export class ChannelOrchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  public async mention(input: MentionInput): Promise<Turn[]> {
    const meta = await this.deps.reader.readMeta(input.channelId)
    if (!meta) throw new ChannelNotFoundError(input.channelId)

    const mentioned = parseMentions(input.prompt, meta.members).slice(0, MAX_PARALLEL_AGENTS)
    if (mentioned.length === 0) return []

    const cleanedPrompt = stripMentions(input.prompt, mentioned)
    const turnIds = await this.deps.writer.reserveTurnIds(meta, mentioned.length)

    const turns = await Promise.all(
      mentioned.map((member, index) => this.runTurn(meta, member, cleanedPrompt, turnIds[index])),
    )

    return turns
  }

  public async recoverChannelsOnStartup(): Promise<void> {
    const channels = await this.deps.reader.listAllChannels()
    for (const meta of channels) {
      // eslint-disable-next-line no-await-in-loop -- recovery walks channels sequentially
      const inFlight = await this.deps.reader.turnsInState(meta, [
        'submitted',
        'routing',
        'in_flight',
        'awaiting_permission',
      ])

      let metaDirty = false
      for (const turn of inFlight) {
        const failed = transition(turn, {reason: 'daemon_restarted', type: 'fail'})
        // eslint-disable-next-line no-await-in-loop -- per-turn audit append must be ordered
        await this.deps.writer.writeTurn(
          meta,
          failed,
          'Turn aborted: daemon restarted. Re-mention the agent to retry.',
          [
            {
              kind: 'error',
              message: 'Turn aborted: daemon restarted',
              suggestion: 'Re-mention the agent to retry',
            },
          ],
        )

        const member = meta.members.find((m) => m.agentId === turn.agentId)
        if (member && (member.status === 'thinking' || member.status === 'awaiting_permission')) {
          member.status = 'errored'
          member.lastTurnAt = failed.endedAt
          metaDirty = true
        }
      }

      if (metaDirty) {
        // eslint-disable-next-line no-await-in-loop -- one meta write per channel is sequential by design
        await this.deps.writer.writeMeta(meta)
      }
    }
  }

  private async runTurn(meta: ChannelMeta, member: ChannelMember, prompt: string, turnId: string): Promise<Turn> {
    const startedAt = new Date().toISOString()
    let turn: Turn = {
      agentId: member.agentId,
      channelId: meta.channelId,
      promptText: prompt,
      startedAt,
      state: 'submitted',
      turnId,
    }

    await this.deps.writer.writeTurnInitial(meta, turn)

    let driver: ChannelAgentDriver
    try {
      driver = this.deps.driverFor(member.agentId, {channelId: meta.channelId, projectRoot: meta.treeRoot})
    } catch (error) {
      const reason = error instanceof AgentNotAvailableError ? error.message : errMsg(error)
      turn = transition(turn, {reason, type: 'fail'})
      await this.deps.writer.writeTurn(meta, turn, '', [{kind: 'error', message: reason}])
      return turn
    }

    const lookback = await this.deps.lookbackBuilder.build(meta, member, prompt)
    const events: TurnEvent[] = []

    turn = transition(turn, {type: 'route'})
    turn = transition(turn, {type: 'start'})

    this.deps.activeTurnTracker?.bind(meta.channelId, turnId, driver, member.agentId)

    try {
      for await (const event of driver.prompt({
        channelId: meta.channelId,
        lookback,
        prompt,
        turnId,
      })) {
        // Permission request: park the turn in `awaiting_permission`. The driver awaits
        // the broker decision internally; subsequent events resume the iteration here.
        if (event.kind === 'permission_request' && turn.state === 'in_flight') {
          turn = transition(turn, {permissionRequestId: event.permissionRequestId, type: 'await_permission'})
          events.push(event)
          // Codex F2 review fix — persist `awaiting_permission` immediately so `brv channel get`
          // can observe the parked turn while the driver is blocked on the broker. Without this
          // mid-loop write, the on-disk turn stays at the previous state until `prompt()` returns.
          await this.deps.writer.writeTurn(meta, turn, joinMessages(events), events)
          await this.deps.serializer.run(`${meta.channelId}:${turnId}`, async () => {
            this.deps.publish(meta.channelId, {channelId: meta.channelId, event, turnId, type: 'turn-event'})
          })
          continue
        }

        if (turn.state === 'awaiting_permission') {
          // First non-permission event after parking — decision arrived as `allow`/`always`.
          // (A `deny` surfaces as `PermissionExpiredError` or driver-thrown error, not continued events.)
          turn = transition(turn, {decision: 'allow', type: 'permission_decision'})
        }

        events.push(event)
        await this.deps.serializer.run(`${meta.channelId}:${turnId}`, async () => {
          this.deps.publish(meta.channelId, {channelId: meta.channelId, event, turnId, type: 'turn-event'})
        })
      }

      turn = transition(turn, {type: 'complete'})
    } catch (error) {
      if (error instanceof TurnCancelledError) {
        // Codex F4 review fix — driver detected a soft cancel; persist `state: 'cancelled'`
        // so the API success response matches the stored turn state.
        events.push({kind: 'error', message: 'turn cancelled', suggestion: 'mention again to retry'})
        turn = transition(turn, {type: 'cancel'})
      } else if (error instanceof PermissionDeniedError) {
        // Codex re-review Finding 1 — broker resolved with `deny`. Apply `permission_decision: deny`
        // (state machine maps `awaiting_permission` → `failed`). If for some reason the turn already
        // moved past `awaiting_permission`, fall back to a plain `fail` transition.
        events.push({kind: 'error', message: 'permission denied', suggestion: 'mention again to retry'})
        turn = turn.state === 'awaiting_permission'
          ? transition(turn, {decision: 'deny', type: 'permission_decision'})
          : transition(turn, {reason: 'permission denied', type: 'fail'})
      } else if (error instanceof PermissionExpiredError) {
        events.push({kind: 'error', message: 'permission expired', suggestion: 're-mention to retry'})
        turn = transition(turn, {type: 'expire'})
      } else {
        const reason = errMsg(error)
        events.push({kind: 'error', message: reason})
        turn = transition(turn, {reason, type: 'fail'})
      }
    } finally {
      this.deps.activeTurnTracker?.unbind(meta.channelId, turnId)
    }

    turn.toolCallCount = countTools(events)
    turn.artifactsTouched = collectArtifacts(events)

    await this.deps.writer.writeTurn(meta, turn, joinMessages(events), events)
    return turn
  }
}

/** Extract `@<agent>` mentions from a prompt and resolve to known channel members. */
export function parseMentions(prompt: string, members: ChannelMember[]): ChannelMember[] {
  const tokens = prompt.match(/@[\w-]+/g) ?? []
  const ids = new Set(tokens.map((token) => token.slice(1)))
  const seen = new Set<string>()
  const resolved: ChannelMember[] = []
  for (const member of members) {
    if (ids.has(member.agentId) && !seen.has(member.agentId)) {
      seen.add(member.agentId)
      resolved.push(member)
    }
  }

  return resolved
}

/** Strip `@<agent>` tokens for the resolved set, leaving the prompt body. */
export function stripMentions(prompt: string, mentioned: ChannelMember[]): string {
  const ids = new Set(mentioned.map((m) => m.agentId))
  return prompt
    .replaceAll(/@[\w-]+/g, (token) => (ids.has(token.slice(1)) ? '' : token))
    .replaceAll(/\s+/g, ' ')
    .trim()
}

export function joinMessages(events: TurnEvent[]): string {
  const parts: string[] = []
  for (const event of events) {
    if (event.kind === 'token') parts.push(event.delta)
    else if (event.kind === 'message') parts.push(event.content)
  }

  return parts.join('')
}

export function errMsg(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function countTools(events: TurnEvent[]): number {
  return events.filter((event) => event.kind === 'tool').length
}

function collectArtifacts(events: TurnEvent[]): string[] {
  const seen = new Set<string>()
  for (const event of events) {
    if (event.kind === 'artifact' || event.kind === 'artifact_intent') {
      seen.add(event.path)
    }
  }

  return [...seen]
}
