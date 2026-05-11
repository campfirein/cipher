import type {
  Channel,
  ChannelMeta,
  ContentBlock,
  Turn,
  TurnEvent,
} from '../../../shared/types/channel.js'
import type {IChannelBroadcaster} from '../../core/interfaces/channel/i-channel-broadcaster.js'
import type {
  ArchiveChannelArgs,
  CreateChannelArgs,
  GetChannelArgs,
  GetTurnArgs,
  GetTurnResult,
  IChannelOrchestrator,
  ListChannelsArgs,
  ListTurnsArgs,
  ListTurnsResult,
  PostTurnArgs,
} from '../../core/interfaces/channel/i-channel-orchestrator.js'
import type {IChannelStore} from '../../core/interfaces/channel/i-channel-store.js'

import {ChannelEvents} from '../../../shared/transport/events/channel-events.js'
import {
  ChannelAlreadyExistsError,
  ChannelArchivedError,
  ChannelNotFoundError,
  ChannelPromptEmptyError,
  ChannelTurnNotFoundError,
} from '../../core/domain/channel/errors.js'
import {assertLegalTurnTransition} from '../../core/domain/channel/turn-state-machine.js'

/**
 * Phase-1 channel orchestrator. Composes the channel store + broadcaster +
 * id-generator + clock to implement the 7 Phase-1 orchestrator methods
 * (create / list / get / archive / postTurn / listTurns / getTurn).
 *
 * Phase-1 turn lifecycle for passive `channel:post`:
 *
 *   1. Validate prompt-emptiness per CHANNEL_PROTOCOL.md §8.4 (throws
 *      ChannelPromptEmptyError on whitespace-only / no-blocks input).
 *   2. Normalise prompt + promptBlocks into a final ContentBlock[].
 *   3. Allocate turnId, write `Turn` in `state: 'pending'` (via the events
 *      writer's first append).
 *   4. Append a `message` TurnEvent capturing the prompt text.
 *   5. Transition pending → completed (state-machine asserts legality).
 *   6. Append a `turn_state_change` event.
 *   7. Write the one-shot `turn.json` snapshot.
 *   8. Broadcast every event over `channel:turn-event`.
 *
 * Phase-2 mention/cancel/permission methods extend this surface; they are
 * intentionally absent from the Phase-1 interface.
 */
export type ChannelOrchestratorDeps = {
  readonly broadcaster: IChannelBroadcaster
  readonly clock: () => Date
  readonly idGenerator: () => string
  readonly store: IChannelStore
}

const isWhitespaceOnly = (text: string): boolean => text.trim() === ''

const blockIsEmpty = (block: ContentBlock): boolean => {
  if (block.type === 'text') return isWhitespaceOnly(block.text)
  // Non-text blocks (resource_link, resource, image, audio) are always
  // considered non-empty per CHANNEL_PROTOCOL.md §8.4: a structured-only
  // request with a resource_link is valid even with no text.
  return false
}

/**
 * Normalise `(prompt, promptBlocks)` into the final ContentBlock[] per the
 * §8.4 precedence rules. Throws ChannelPromptEmptyError if the result would
 * be empty (no blocks, or only whitespace-only text blocks).
 */
const normalisePrompt = (args: {
  prompt?: string
  promptBlocks?: ContentBlock[]
}): ContentBlock[] => {
  const hasPrompt = args.prompt !== undefined && !isWhitespaceOnly(args.prompt)
  const hasBlocks = args.promptBlocks !== undefined && args.promptBlocks.length > 0

  if (!hasPrompt && !hasBlocks) throw new ChannelPromptEmptyError()

  let result: ContentBlock[]
  if (hasBlocks && hasPrompt) {
    result = [...args.promptBlocks!, {text: args.prompt!, type: 'text'}]
  } else if (hasBlocks) {
    result = args.promptBlocks!
  } else {
    // prompt only
    result = [{text: args.prompt!, type: 'text'}]
  }

  // The only block-shaped emptiness left is "blocks were provided but every
  // block is whitespace-only text".
  if (result.every((b) => blockIsEmpty(b))) throw new ChannelPromptEmptyError()

  return result
}

const firstTextOf = (blocks: ContentBlock[]): string => {
  for (const b of blocks) {
    if (b.type === 'text') return b.text
  }

  // Fall back to a structural marker so the message event still has content
  // even for structured-only prompts (e.g. resource_link).
  return '[structured prompt]'
}

export class ChannelOrchestrator implements IChannelOrchestrator {
  private readonly broadcaster: IChannelBroadcaster
  private readonly clock: () => Date
  private readonly idGenerator: () => string
  private readonly store: IChannelStore

  public constructor(deps: ChannelOrchestratorDeps) {
    this.broadcaster = deps.broadcaster
    this.clock = deps.clock
    this.idGenerator = deps.idGenerator
    this.store = deps.store
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────

  async archiveChannel(args: ArchiveChannelArgs): Promise<Channel> {
    const now = this.clock().toISOString()
    let channel: Channel
    try {
      channel = await this.store.updateChannelMeta({
        channelId: args.channelId,
        mutate: (meta) => ({...meta, archivedAt: meta.archivedAt ?? now, updatedAt: now}),
        projectRoot: args.projectRoot,
      })
    } catch (error) {
      if (error instanceof Error && /not found/i.test(error.message)) {
        throw new ChannelNotFoundError(args.channelId)
      }

      throw error
    }

    this.broadcaster.broadcastToChannel(args.channelId, ChannelEvents.STATE_CHANGE, {
      channel,
      channelId: args.channelId,
    })

    return channel
  }

  async createChannel(args: CreateChannelArgs): Promise<Channel> {
    const now = this.clock().toISOString()
    const channelId = args.channelId ?? this.idGenerator()

    const meta: ChannelMeta = {
      channelId,
      createdAt: now,
      members: [],
      title: args.title,
      updatedAt: now,
    }

    let channel: Channel
    try {
      channel = await this.store.createChannel({meta, projectRoot: args.projectRoot})
    } catch (error) {
      if (
        error instanceof Error &&
        /already exists/i.test(error.message)
      ) {
        throw new ChannelAlreadyExistsError(channelId)
      }

      throw error
    }

    this.broadcaster.broadcastToChannel(channelId, ChannelEvents.STATE_CHANGE, {
      channel,
      channelId,
    })

    return channel
  }

  async getChannel(args: GetChannelArgs): Promise<Channel> {
    const channel = await this.store.readChannel({
      channelId: args.channelId,
      projectRoot: args.projectRoot,
    })
    if (channel === undefined) throw new ChannelNotFoundError(args.channelId)
    return channel
  }

  async getTurn(args: GetTurnArgs): Promise<GetTurnResult> {
    const channel = await this.store.readChannel({
      channelId: args.channelId,
      projectRoot: args.projectRoot,
    })
    if (channel === undefined) throw new ChannelNotFoundError(args.channelId)

    const result = await this.store.readTurn({
      channelId: args.channelId,
      projectRoot: args.projectRoot,
      turnId: args.turnId,
    })
    if (result === undefined) throw new ChannelTurnNotFoundError(args.channelId, args.turnId)

    return {events: result.events, turn: result.turn}
  }

  // ─── Turns ─────────────────────────────────────────────────────────────

  async listChannels(args: ListChannelsArgs): Promise<Channel[]> {
    return this.store.listChannels({
      includeArchived: args.archived === true,
      projectRoot: args.projectRoot,
    })
  }

  async listTurns(args: ListTurnsArgs): Promise<ListTurnsResult> {
    // Phase 1: ensure the channel exists; throwing here matches the §8.4 spec.
    const channel = await this.store.readChannel({
      channelId: args.channelId,
      projectRoot: args.projectRoot,
    })
    if (channel === undefined) throw new ChannelNotFoundError(args.channelId)

    const result = await this.store.listTurns({
      channelId: args.channelId,
      cursor: args.cursor,
      limit: args.limit,
      projectRoot: args.projectRoot,
    })

    return {nextCursor: result.nextCursor, turns: result.turns}
  }

  async postTurn(args: PostTurnArgs): Promise<Turn> {
    const channel = await this.store.readChannel({
      channelId: args.channelId,
      projectRoot: args.projectRoot,
    })
    if (channel === undefined) throw new ChannelNotFoundError(args.channelId)
    if (channel.archivedAt !== undefined) throw new ChannelArchivedError(args.channelId)

    const promptBlocks = normalisePrompt({prompt: args.prompt, promptBlocks: args.promptBlocks})
    const turnId = this.idGenerator()
    const startedAt = this.clock().toISOString()

    // Append message event (seq 0).
    const messageEvent: TurnEvent = {
      channelId: args.channelId,
      content: firstTextOf(promptBlocks),
      deliveryId: null,
      emittedAt: startedAt,
      kind: 'message',
      memberHandle: null,
      role: 'user',
      seq: 0,
      turnId,
    }
    await this.store.appendTurnEvent({
      channelId: args.channelId,
      event: messageEvent,
      projectRoot: args.projectRoot,
      turnId,
    })
    this.broadcaster.broadcastToChannel(args.channelId, ChannelEvents.TURN_EVENT, {
      channelId: args.channelId,
      event: messageEvent,
    })

    // Transition pending → completed (state-machine assertion, single step
    // for passive turns).
    assertLegalTurnTransition('pending', 'completed')
    const endedAt = this.clock().toISOString()
    const stateChange: TurnEvent = {
      channelId: args.channelId,
      deliveryId: null,
      emittedAt: endedAt,
      from: 'pending',
      kind: 'turn_state_change',
      memberHandle: null,
      seq: 1,
      to: 'completed',
      turnId,
    }
    await this.store.appendTurnEvent({
      channelId: args.channelId,
      event: stateChange,
      projectRoot: args.projectRoot,
      turnId,
    })
    this.broadcaster.broadcastToChannel(args.channelId, ChannelEvents.TURN_EVENT, {
      channelId: args.channelId,
      event: stateChange,
    })

    // Persist the finalisation snapshot.
    const turn: Turn = {
      author: {handle: 'you', kind: 'local-user'},
      channelId: args.channelId,
      endedAt,
      idempotencyKey: args.idempotencyKey,
      mentions: [],
      promptBlocks,
      promptedBy: 'user',
      startedAt,
      state: 'completed',
      turnId,
    }
    await this.store.writeTurnSnapshot({
      channelId: args.channelId,
      projectRoot: args.projectRoot,
      turn,
      turnId,
    })

    return turn
  }
}
