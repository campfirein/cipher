import type {z} from 'zod'

import type {IChannelOrchestrator} from '../../../core/interfaces/channel/i-channel-orchestrator.js'
import type {IDriverProfileStore} from '../../../core/interfaces/channel/i-driver-profile-store.js'
import type {
  ITransportServer,
  RequestContext,
  RequestHandler,
} from '../../../core/interfaces/transport/i-transport-server.js'
import type {IChannelDoctorService} from '../../channel/doctor-service.js'
import type {IChannelOnboardService} from '../../channel/onboard-service.js'

import {
  ChannelArchiveRequestSchema,
  ChannelCancelRequestSchema,
  ChannelCreateRequestSchema,
  ChannelDoctorRequestSchema,
  ChannelEvents,
  ChannelGetRequestSchema,
  ChannelGetTurnRequestSchema,
  ChannelInviteRequestSchema,
  ChannelListRequestSchema,
  ChannelListTurnsRequestSchema,
  ChannelMentionRequestSchema,
  ChannelOnboardRequestSchema,
  ChannelPermissionDecisionRequestSchema,
  ChannelPostRequestSchema,
  ChannelProfileListRequestSchema,
  ChannelProfileRemoveRequestSchema,
  ChannelProfileShowRequestSchema,
  ChannelRotateTokenRequestSchema,
  ChannelUninviteRequestSchema,
} from '../../../../shared/transport/events/channel-events.js'
import {
  ChannelInvalidRequestError,
  ChannelProfileNotFoundError,
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
  /**
   * Either a static token (legacy / unit tests) OR a provider callback
   * (production wiring as of Slice 3.5a). The middleware reads the value
   * on every request so rotation takes effect without re-registering.
   */
  readonly authToken: (() => string) | string
  /** Phase-3 doctor service. Optional so Phase-1/2 tests can omit it. */
  readonly doctorService?: IChannelDoctorService
  /** Phase-3 onboard service. Optional so Phase-1/2 tests can omit it. */
  readonly onboardService?: IChannelOnboardService
  readonly orchestrator: IChannelOrchestrator
  /** Phase-3 driver-profile registry. Optional so Phase-1/2 tests can omit it. */
  readonly profileStore?: IDriverProfileStore
  /**
   * Phase-3 token-rotation callback. The handler fires this when
   * `channel:rotate-token` runs successfully. Slice 3.5 wires this to
   * disconnect every active client + emit a structured INFO log.
   */
  readonly rotateToken?: () => Promise<{disconnectedClients: number; tokenFingerprint: string}>
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
  private readonly authToken: (() => string) | string
  private readonly doctorService: IChannelDoctorService | undefined
  private readonly onboardService: IChannelOnboardService | undefined
  private readonly orchestrator: IChannelOrchestrator
  private readonly profileStore: IDriverProfileStore | undefined
  private readonly rotateTokenFn: (() => Promise<{disconnectedClients: number; tokenFingerprint: string}>) | undefined

  public constructor(deps: ChannelHandlerDeps) {
    this.authToken = deps.authToken
    this.doctorService = deps.doctorService
    this.onboardService = deps.onboardService
    this.orchestrator = deps.orchestrator
    this.profileStore = deps.profileStore
    this.rotateTokenFn = deps.rotateToken
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

    // ─── Phase-2 request events ───────────────────────────────────────

    // channel:invite
    register(ChannelEvents.INVITE, async (data, _clientId, ctx) => {
      const projectRoot = projectRootFromCtx(ctx)
      const req = parseOrThrow(ChannelInviteRequestSchema, data)
      const member = await this.orchestrator.inviteMember({
        capabilities: req.capabilities,
        channelId: req.channelId,
        handle: req.handle,
        invocation: req.invocation,
        profileName: req.profileName,
        projectRoot,
      })
      return {member}
    })

    // channel:uninvite
    register(ChannelEvents.UNINVITE, async (data, _clientId, ctx) => {
      const projectRoot = projectRootFromCtx(ctx)
      const req = parseOrThrow(ChannelUninviteRequestSchema, data)
      const member = await this.orchestrator.uninviteMember({
        channelId: req.channelId,
        memberHandle: req.memberHandle,
        projectRoot,
      })
      return {member}
    })

    // channel:mention — synchronous validation + dispatch; background streams.
    // Slice 8.0 — when `mode: 'sync'`, the handler awaits the orchestrator's
    // pending-sync promise and returns the assembled `ChannelMentionSyncResponse`
    // instead of the immediate `ChannelTurnAcceptedResponse`.
    register(ChannelEvents.MENTION, async (data, _clientId, ctx) => {
      const projectRoot = projectRootFromCtx(ctx)
      const req = parseOrThrow(ChannelMentionRequestSchema, data)
      const result = await this.orchestrator.dispatchMention({
        channelId: req.channelId,
        idempotencyKey: req.idempotencyKey,
        mentions: req.mentions,
        mode: req.mode,
        projectRoot,
        prompt: req.prompt,
        promptBlocks: req.promptBlocks,
        suppressThoughts: req.suppressThoughts,
        timeout: req.timeout,
      })

      if (req.mode === 'sync') {
        return this.orchestrator.awaitSyncMention(result.turn.turnId)
      }

      return {deliveries: result.deliveries, turn: result.turn}
    })

    // channel:cancel
    register(ChannelEvents.CANCEL, async (data, _clientId, ctx) => {
      const projectRoot = projectRootFromCtx(ctx)
      const req = parseOrThrow(ChannelCancelRequestSchema, data)
      const result = await this.orchestrator.cancelTurn({
        channelId: req.channelId,
        deliveryId: req.deliveryId,
        projectRoot,
        turnId: req.turnId,
      })
      return {deliveries: result.deliveries, turn: result.turn}
    })

    // channel:permission-decision
    register(ChannelEvents.PERMISSION_DECISION, async (data, _clientId, ctx) => {
      const projectRoot = projectRootFromCtx(ctx)
      const req = parseOrThrow(ChannelPermissionDecisionRequestSchema, data)
      const event = await this.orchestrator.permissionDecision({
        channelId: req.channelId,
        outcome: req.outcome,
        permissionRequestId: req.permissionRequestId,
        projectRoot,
        turnId: req.turnId,
      })
      return {event}
    })

    // ─── Phase-3 request events ───────────────────────────────────────

    // channel:onboard — probe a candidate agent and persist the profile.
    register(ChannelEvents.ONBOARD, async (data, _clientId, ctx) => {
      // Ensure cwd is present for parity with the rest of the channel surface.
      projectRootFromCtx(ctx)
      const req = parseOrThrow(ChannelOnboardRequestSchema, data)
      const svc = this.onboardService
      if (svc === undefined) {
        throw new ChannelInvalidRequestError(
          'channel:onboard is not wired on this host (the daemon was built without the onboard service)',
          {phase: 3},
        )
      }

      const result = await svc.onboard({
        displayName: req.displayName,
        invocation: req.invocation,
        profileName: req.profileName,
      })
      return result
    })

    // channel:doctor — aggregate channel/pool/broker/profile diagnostics.
    register(ChannelEvents.DOCTOR, async (data, _clientId, ctx) => {
      const projectRoot = projectRootFromCtx(ctx)
      const req = parseOrThrow(ChannelDoctorRequestSchema, data)
      const svc = this.doctorService
      if (svc === undefined) {
        throw new ChannelInvalidRequestError(
          'channel:doctor is not wired on this host (the daemon was built without the doctor service)',
          {phase: 3},
        )
      }

      const result = await svc.run({
        channelId: req.channelId,
        memberHandle: req.memberHandle,
        profileName: req.profileName,
        projectRoot,
      })
      return result
    })

    // channel:profile-list — list every persisted driver profile.
    register(ChannelEvents.PROFILE_LIST, async (data, _clientId, ctx) => {
      projectRootFromCtx(ctx)
      parseOrThrow(ChannelProfileListRequestSchema, data)
      const store = this.profileStore
      if (store === undefined) {
        throw new ChannelInvalidRequestError(
          'channel:profile-list requires the driver-profile registry (Phase 3)',
          {phase: 3},
        )
      }

      return {profiles: await store.list()}
    })

    // channel:profile-show — read one profile by name.
    register(ChannelEvents.PROFILE_SHOW, async (data, _clientId, ctx) => {
      projectRootFromCtx(ctx)
      const req = parseOrThrow(ChannelProfileShowRequestSchema, data)
      const store = this.profileStore
      if (store === undefined) {
        throw new ChannelInvalidRequestError(
          'channel:profile-show requires the driver-profile registry (Phase 3)',
          {phase: 3},
        )
      }

      const profile = await store.get(req.name)
      if (profile === undefined) throw new ChannelProfileNotFoundError(req.name)
      return {profile}
    })

    // channel:profile-remove — idempotent removal.
    register(ChannelEvents.PROFILE_REMOVE, async (data, _clientId, ctx) => {
      projectRootFromCtx(ctx)
      const req = parseOrThrow(ChannelProfileRemoveRequestSchema, data)
      const store = this.profileStore
      if (store === undefined) {
        throw new ChannelInvalidRequestError(
          'channel:profile-remove requires the driver-profile registry (Phase 3)',
          {phase: 3},
        )
      }

      return {removed: await store.remove(req.name)}
    })

    // channel:rotate-token — regenerate the daemon-auth-token. Returns a
    // fingerprint and the count of disconnected clients; never the token.
    register(ChannelEvents.ROTATE_TOKEN, async (data) => {
      // Token rotation does NOT require cwd — it's a daemon-global op.
      parseOrThrow(ChannelRotateTokenRequestSchema, data)
      const rotate = this.rotateTokenFn
      if (rotate === undefined) {
        throw new ChannelInvalidRequestError(
          'channel:rotate-token requires the auth-token-rotation hook (Slice 3.5)',
          {phase: 3},
        )
      }

      return rotate()
    })
  }
}
