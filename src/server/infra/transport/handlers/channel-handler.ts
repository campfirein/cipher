import type {z} from 'zod'

import type {IChannelOrchestrator} from '../../../core/interfaces/channel/i-channel-orchestrator.js'
import type {
  ITransportServer,
  RequestContext,
  RequestHandler,
} from '../../../core/interfaces/transport/i-transport-server.js'

import {
  ChannelArchiveRequestSchema,
  ChannelCreateRequestSchema,
  ChannelEvents,
  ChannelGetRequestSchema,
  ChannelGetTurnRequestSchema,
  ChannelListRequestSchema,
  ChannelListTurnsRequestSchema,
  ChannelPostRequestSchema,
} from '../../../../shared/transport/events/channel-events.js'
import {
  ChannelInvalidRequestError,
} from '../../../core/domain/channel/errors.js'
import {makeChannelAuthMiddleware} from '../../auth/channel-auth-middleware.js'

/**
 * Phase-1 channel transport handler.
 *
 * Registers handlers for the 7 client-to-host events that Phase 1 supports
 * (create/list/get/archive/post/list-turns/get-turn). Each handler:
 *
 *   1. Runs behind the {@link makeChannelAuthMiddleware} so missing or
 *      invalid tokens fail with CHANNEL_UNAUTHORIZED before any orchestrator
 *      method is called.
 *   2. Validates the request payload against the zod schema for that event
 *      (CHANNEL_PROTOCOL.md §8); validation failures throw
 *      CHANNEL_INVALID_REQUEST with structured `details` so clients can
 *      surface specific field errors.
 *   3. Pulls `projectRoot` from `ctx.cwd` (Socket.IO handshake `cwd` query
 *      param). Missing cwd is treated as CHANNEL_INVALID_REQUEST — Phase 1
 *      clients always send a cwd.
 *   4. Delegates to the orchestrator and forwards the response or
 *      ChannelError back through the transport's error envelope.
 *
 * Phase-2 events (mention/cancel/invite/uninvite/members/permission) are
 * deliberately NOT registered. Phase-3 events (onboard/doctor) are also
 * absent. Broadcasts (channel:turn-event, channel:member-update,
 * channel:state-change) are emitted by the orchestrator via the broadcaster;
 * they are not request handlers.
 */
export type ChannelHandlerDeps = {
  readonly authToken: string
  readonly orchestrator: IChannelOrchestrator
}

/**
 * Subset of {@link ITransportServer} the handler depends on. Exposed
 * separately so tests can stub registration without booting Socket.IO.
 */
type TransportRegistry = Pick<ITransportServer, 'onRequest'>

const parseOrThrow = <T>(schema: z.ZodType<T>, data: unknown): T => {
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    throw new ChannelInvalidRequestError(
      'channel request payload failed schema validation',
      parsed.error.flatten(),
    )
  }

  return parsed.data
}

const projectRootFromCtx = (ctx?: RequestContext): string => {
  const cwd = ctx?.cwd
  if (typeof cwd !== 'string' || cwd === '') {
    throw new ChannelInvalidRequestError(
      'channel handlers require the client to send `cwd` on the Socket.IO handshake to resolve the project root',
      {field: 'cwd'},
    )
  }

  return cwd
}

export class ChannelHandler {
  private readonly authToken: string
  private readonly orchestrator: IChannelOrchestrator

  public constructor(deps: ChannelHandlerDeps) {
    this.authToken = deps.authToken
    this.orchestrator = deps.orchestrator
  }

  registerOn(transport: TransportRegistry): void {
    const withAuth = makeChannelAuthMiddleware(this.authToken)

    const register = <TReq, TRes>(event: string, inner: RequestHandler<TReq, TRes>): void => {
      transport.onRequest(event, withAuth(inner))
    }

    // channel:create
    register(ChannelEvents.CREATE, async (data, _clientId, ctx) => {
      const projectRoot = projectRootFromCtx(ctx)
      const req = parseOrThrow(ChannelCreateRequestSchema, data)
      const channel = await this.orchestrator.createChannel({
        channelId: req.channelId,
        projectRoot,
        title: req.title,
      })
      return {channel}
    })

    // channel:list
    register(ChannelEvents.LIST, async (data, _clientId, ctx) => {
      const projectRoot = projectRootFromCtx(ctx)
      const req = parseOrThrow(ChannelListRequestSchema, data)
      const channels = await this.orchestrator.listChannels({
        archived: req.archived,
        projectRoot,
      })
      return {channels}
    })

    // channel:get
    register(ChannelEvents.GET, async (data, _clientId, ctx) => {
      const projectRoot = projectRootFromCtx(ctx)
      const req = parseOrThrow(ChannelGetRequestSchema, data)
      const channel = await this.orchestrator.getChannel({
        channelId: req.channelId,
        projectRoot,
      })
      return {channel}
    })

    // channel:archive
    register(ChannelEvents.ARCHIVE, async (data, _clientId, ctx) => {
      const projectRoot = projectRootFromCtx(ctx)
      const req = parseOrThrow(ChannelArchiveRequestSchema, data)
      const channel = await this.orchestrator.archiveChannel({
        channelId: req.channelId,
        projectRoot,
      })
      return {channel}
    })

    // channel:post (passive turn)
    register(ChannelEvents.POST, async (data, _clientId, ctx) => {
      const projectRoot = projectRootFromCtx(ctx)
      const req = parseOrThrow(ChannelPostRequestSchema, data)
      const turn = await this.orchestrator.postTurn({
        channelId: req.channelId,
        idempotencyKey: req.idempotencyKey,
        projectRoot,
        prompt: req.prompt,
        promptBlocks: req.promptBlocks,
      })
      // CHANNEL_PROTOCOL.md §8.4: passive turns return `{turn, deliveries: []}`
      // but the deliveries field is optional in the response schema.
      return {turn}
    })

    // channel:list-turns
    register(ChannelEvents.LIST_TURNS, async (data, _clientId, ctx) => {
      const projectRoot = projectRootFromCtx(ctx)
      const req = parseOrThrow(ChannelListTurnsRequestSchema, data)
      const result = await this.orchestrator.listTurns({
        channelId: req.channelId,
        cursor: req.cursor,
        limit: req.limit,
        projectRoot,
      })
      return {nextCursor: result.nextCursor, turns: result.turns}
    })

    // channel:get-turn
    register(ChannelEvents.GET_TURN, async (data, _clientId, ctx) => {
      const projectRoot = projectRootFromCtx(ctx)
      const req = parseOrThrow(ChannelGetTurnRequestSchema, data)
      const result = await this.orchestrator.getTurn({
        channelId: req.channelId,
        projectRoot,
        turnId: req.turnId,
      })
      // Phase-1 passive turns: omit `deliveries` entirely (the field is
      // optional in `ChannelGetTurnResponseSchema` per fixup `bae8bbf2`).
      // Phase-2 active turns: forward the reconstructed delivery list.
      return result.deliveries === undefined
        ? {events: result.events, turn: result.turn}
        : {deliveries: result.deliveries, events: result.events, turn: result.turn}
    })
  }
}
