import type {
  Channel,
  Turn,
  TurnEvent,
} from '../../../../shared/types/channel.js'

/**
 * Phase-1 channel orchestrator contract.
 *
 * Slice 1.4 lands the concrete implementation; Slice 1.2's transport handler
 * registers handlers that delegate here. Phase-2 methods (`mentionTurn`,
 * `cancelTurn`, `inviteMember`, `uninviteMember`) land alongside Phase 2 and
 * extend (do not replace) this interface.
 *
 * Project scoping: every method accepts a `projectRoot` so the orchestrator
 * routes to the right `.brv/context-tree/` per channel. The handler resolves
 * the active project from the request context.
 */

export type CreateChannelArgs = {
  readonly channelId?: string
  readonly projectRoot: string
  readonly title?: string
}

export type ListChannelsArgs = {
  readonly archived?: boolean
  readonly projectRoot: string
}

export type GetChannelArgs = {
  readonly channelId: string
  readonly projectRoot: string
}

export type ArchiveChannelArgs = GetChannelArgs

export type PostTurnArgs = {
  readonly channelId: string
  readonly idempotencyKey?: string
  readonly projectRoot: string
  readonly prompt?: string
  readonly promptBlocks?: import('../../../../shared/types/channel.js').ContentBlock[]
}

export type ListTurnsArgs = {
  readonly channelId: string
  readonly cursor?: string
  readonly limit?: number
  readonly projectRoot: string
}

export type ListTurnsResult = {
  readonly nextCursor?: string
  readonly turns: Turn[]
}

export type GetTurnArgs = {
  readonly channelId: string
  readonly projectRoot: string
  readonly turnId: string
}

export type GetTurnResult = {
  readonly events: TurnEvent[]
  readonly turn: Turn
}

/**
 * Phase-1 orchestrator surface. Implementations MUST validate inputs against
 * the channel-events.ts zod request schemas before calling these methods —
 * the handler does this; orchestrator methods can trust their arguments.
 *
 * Errors thrown MUST be `ChannelError` subclasses from
 * `src/server/core/domain/channel/errors.js`. The handler maps them onto the
 * wire error envelope.
 */
export interface IChannelOrchestrator {
  archiveChannel(args: ArchiveChannelArgs): Promise<Channel>
  createChannel(args: CreateChannelArgs): Promise<Channel>
  getChannel(args: GetChannelArgs): Promise<Channel>
  getTurn(args: GetTurnArgs): Promise<GetTurnResult>
  listChannels(args: ListChannelsArgs): Promise<Channel[]>
  listTurns(args: ListTurnsArgs): Promise<ListTurnsResult>
  postTurn(args: PostTurnArgs): Promise<Turn>
}
