import type {
  AgentDriverProfileInvocation,
  Channel,
  ChannelMember,
  ChannelMemberAcpAgent,
  ChannelMeta,
  ContentBlock,
  Turn,
  TurnDelivery,
  TurnEvent,
} from '../../../shared/types/channel.js'
import type {IAcpDriver, TurnEventPayload} from '../../core/interfaces/channel/i-acp-driver.js'
import type {IChannelBroadcaster} from '../../core/interfaces/channel/i-channel-broadcaster.js'
import type {
  ArchiveChannelArgs,
  CancelTurnArgs,
  CancelTurnResult,
  CreateChannelArgs,
  DispatchMentionArgs,
  DispatchMentionResult,
  GetChannelArgs,
  GetTurnArgs,
  GetTurnResult,
  IChannelOrchestrator,
  InviteMemberArgs,
  ListChannelsArgs,
  ListTurnsArgs,
  ListTurnsResult,
  PermissionDecisionArgs,
  PostTurnArgs,
  UninviteMemberArgs,
} from '../../core/interfaces/channel/i-channel-orchestrator.js'
import type {IChannelStore} from '../../core/interfaces/channel/i-channel-store.js'
import type {IAcpDriverPool} from '../../core/interfaces/channel/i-driver-pool.js'
import type {IDriverProfileStore} from '../../core/interfaces/channel/i-driver-profile-store.js'
import type {ITurnSequenceAllocator} from '../../core/interfaces/channel/i-turn-sequence-allocator.js'

import {ChannelEvents} from '../../../shared/transport/events/channel-events.js'
import {
  AcpPromptFailedError,
  AgentDriverProfileNotFoundError,
  ChannelAlreadyExistsError,
  ChannelArchivedError,
  ChannelInvalidRequestError,
  ChannelMentionEmptyError,
  ChannelNotFoundError,
  ChannelTurnNotFoundError,
} from '../../core/domain/channel/errors.js'
import {assertLegalTurnTransition} from '../../core/domain/channel/turn-state-machine.js'
import {CancelCoordinator, type CancelDeliveryRef} from './drivers/cancel-coordinator.js'
import {IPermissionBroker} from './drivers/permission-broker.js'
import {buildLookback} from './lookback-builder.js'
import {resolveMentions} from './member-resolver.js'
import {parseMentions} from './mention-parser.js'
import {normalisePrompt} from './prompt-normaliser.js'

/**
 * Channel orchestrator (Phase 1 lifecycle + Phase 2 active dispatch).
 *
 * Phase 1 surface: create / list / get / archive / postTurn / listTurns /
 * getTurn — passive transcript management.
 *
 * Phase 2 surface (Slice 2.4):
 *   - `inviteMember`: spawn + ACP `initialize` synchronously, persist member,
 *     register driver in the pool. Failure does NOT persist anything.
 *   - `uninviteMember`: cancel in-flight deliveries, release pool driver,
 *     remove member from meta.json.
 *   - `dispatchMention`: synchronous validation + dispatch (emit message
 *     seq-0 + turn_state_change + delivery_state_change) then RETURN; the
 *     background streaming task continues to consume the driver iterator,
 *     emit events, persist snapshots, and finalise the turn.
 *   - `cancelTurn`: delegate to {@link CancelCoordinator} for §7.2 ordering.
 *   - `permissionDecision`: delegate to {@link PermissionBroker.resolve},
 *     emit delivery_state_change + permission_decision events.
 */
export type ChannelOrchestratorDeps = {
  readonly broadcaster: IChannelBroadcaster
  readonly cancelCoordinator: CancelCoordinator
  readonly clock: () => Date
  readonly driverFactory: (
    invocation: ChannelMemberAcpAgent['invocation'],
    handle: string,
  ) => IAcpDriver
  readonly idGenerator: () => string
  readonly permissionBroker: IPermissionBroker
  readonly pool: IAcpDriverPool
  /**
   * Phase-3 driver-profile registry. Optional so Phase-1/2 unit tests can
   * keep constructing the orchestrator without ferrying a store in.
   * `inviteMember` consults the store when `profileName` is supplied.
   */
  readonly profileStore?: IDriverProfileStore
  readonly seqAllocator: ITurnSequenceAllocator
  readonly store: IChannelStore
}

type ActiveTurn = {
  /**
   * Phase-3 cancel guard. Set to `true` synchronously at the start of
   * `cancelTurn` so concurrent background tasks finishing mid-cancel skip
   * `releaseNextQueued` — without this, a late-completing in-flight task
   * could dispatch the next queued delivery AFTER the cancel coordinator
   * has already iterated, leaving a `queued → dispatched` event without
   * a matching `→ cancelled` follow-up.
   */
  cancelling: boolean
  channelId: string
  deliveries: TurnDelivery[]
  members: ChannelMember[]
  projectRoot: string
  turn: Turn
}

const firstTextOf = (blocks: ContentBlock[]): string => {
  for (const b of blocks) {
    if (b.type === 'text') return b.text
  }

  return '[structured prompt]'
}

const collectBlockText = (b: ContentBlock): string => (b.type === 'text' ? b.text : '')

const RESERVED_MENTIONS = new Set(['@all', '@everyone'])

const NON_TERMINAL_DELIVERY_STATES = new Set<TurnDelivery['state']>([
  'awaiting_permission',
  'dispatched',
  'queued',
  'streaming',
])

const FAN_OUT_DEFAULT_MAX_PARALLEL = 4

export class ChannelOrchestrator implements IChannelOrchestrator {
  private readonly activeTurns = new Map<string, ActiveTurn>()
  private readonly broadcaster: IChannelBroadcaster
  private readonly cancelCoordinator: CancelCoordinator
  private readonly clock: () => Date
  private readonly driverFactory: (
    invocation: ChannelMemberAcpAgent['invocation'],
    handle: string,
  ) => IAcpDriver
  private readonly idGenerator: () => string
  private readonly permissionBroker: IPermissionBroker
  private readonly pool: IAcpDriverPool
  private readonly profileStore: IDriverProfileStore | undefined
  private readonly seqAllocator: ITurnSequenceAllocator
  private readonly store: IChannelStore

  public constructor(deps: ChannelOrchestratorDeps) {
    this.broadcaster = deps.broadcaster
    this.cancelCoordinator = deps.cancelCoordinator
    this.clock = deps.clock
    this.driverFactory = deps.driverFactory
    this.idGenerator = deps.idGenerator
    this.permissionBroker = deps.permissionBroker
    this.pool = deps.pool
    this.profileStore = deps.profileStore
    this.seqAllocator = deps.seqAllocator
    this.store = deps.store
  }

  // ─── Phase-1 lifecycle ─────────────────────────────────────────────────

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

    await this.pool.releaseChannel(args.channelId)
    this.broadcaster.broadcastToChannel(args.channelId, ChannelEvents.STATE_CHANGE, {
      channel,
      channelId: args.channelId,
    })

    return channel
  }

  // ─── Phase-2 cancel ───────────────────────────────────────────────────

  async cancelTurn(args: CancelTurnArgs): Promise<CancelTurnResult> {
    const active = this.activeTurns.get(args.turnId)
    if (active === undefined) throw new ChannelTurnNotFoundError(args.channelId, args.turnId)

    // CRITICAL: flip the guard synchronously BEFORE any await so a
    // concurrent background-task completion (running between our awaits)
    // cannot call releaseNextQueued and dispatch a new delivery while
    // the cancel sequence is mid-flight.
    active.cancelling = true

    const inFlight: CancelDeliveryRef[] = active.deliveries.map((d) => ({
      deliveryId: d.deliveryId,
      memberHandle: d.memberHandle,
      state: d.state,
    }))

    if (args.deliveryId === undefined) {
      await this.cancelCoordinator.cancelTurn({
        channelId: args.channelId,
        inFlightDeliveries: inFlight,
        projectRoot: args.projectRoot,
        turnId: args.turnId,
        turnState: active.turn.state,
      })

      // Update in-memory state.
      const endedAt = this.clock().toISOString()
      for (const d of active.deliveries) {
        if (NON_TERMINAL_DELIVERY_STATES.has(d.state)) d.state = 'cancelled'
      }

      active.turn.state = 'cancelled'
      active.turn.endedAt = endedAt
      await this.finaliseTurn(active)
    } else {
      const delivery = active.deliveries.find((d) => d.deliveryId === args.deliveryId)
      if (delivery === undefined) throw new ChannelTurnNotFoundError(args.channelId, args.turnId)
      await this.cancelCoordinator.cancelDelivery({
        channelId: args.channelId,
        delivery: {deliveryId: delivery.deliveryId, memberHandle: delivery.memberHandle, state: delivery.state},
        projectRoot: args.projectRoot,
        turnId: args.turnId,
      })
      delivery.state = 'cancelled'
    }

    return {deliveries: active.deliveries, turn: active.turn}
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
      if (error instanceof Error && /already exists/i.test(error.message)) {
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

  // ─── Phase-2 dispatch ─────────────────────────────────────────────────

  async dispatchMention(args: DispatchMentionArgs): Promise<DispatchMentionResult> {
    const meta = await this.store.readChannelMeta({
      channelId: args.channelId,
      projectRoot: args.projectRoot,
    })
    if (meta === undefined) throw new ChannelNotFoundError(args.channelId)
    if (meta.archivedAt !== undefined) throw new ChannelArchivedError(args.channelId)

    const promptBlocks = normalisePrompt({prompt: args.prompt, promptBlocks: args.promptBlocks})

    // Union parsed mentions + explicit mentions[]; dedupe in first-occurrence
    // order so the parser's deterministic ordering is preserved.
    const seen = new Set<string>()
    const allHandles: string[] = []
    for (const handle of parseMentions(promptBlocks.map((b) => collectBlockText(b)).join(' '))) {
      if (!seen.has(handle)) {
        seen.add(handle)
        allHandles.push(handle)
      }
    }

    for (const handle of args.mentions ?? []) {
      if (!seen.has(handle)) {
        seen.add(handle)
        allHandles.push(handle)
      }
    }

    if (allHandles.length === 0) throw new ChannelMentionEmptyError()

    // Reject reserved handles before resolving membership.
    for (const handle of allHandles) {
      if (RESERVED_MENTIONS.has(handle)) {
        throw new ChannelInvalidRequestError(
          `Reserved mention ${handle} (e.g. @everyone, @all) is not supported in v0.1.`,
          {handle},
        )
      }
    }

    const members = resolveMentions(meta, allHandles)

    // Phase-3 fan-out: cap from channel settings (default 4). Surplus
    // members queue FIFO behind the in-flight slots. Phase 4+ may
    // introduce a global ChannelSettings.maxParallelAgents wire surface.
    const maxParallel = meta.settings?.maxParallelAgents ?? FAN_OUT_DEFAULT_MAX_PARALLEL

    const turnId = this.idGenerator()
    const startedAt = this.clock().toISOString()
    this.seqAllocator.reset({channelId: args.channelId, turnId})

    // Step 7: emit user `message` event at seq 0.
    const messageSeq = this.seqAllocator.next({channelId: args.channelId, turnId})
    const messageEvent: TurnEvent = {
      channelId: args.channelId,
      content: firstTextOf(promptBlocks),
      deliveryId: null,
      emittedAt: startedAt,
      kind: 'message',
      memberHandle: null,
      role: 'user',
      seq: messageSeq,
      turnId,
    }
    await this.persistAndBroadcast(args.channelId, args.projectRoot, turnId, messageEvent)

    // Step 8: build in-memory Turn + N TurnDelivery (all `queued`).
    const deliveries: TurnDelivery[] = members.map((m) => ({
      artifactsTouched: [],
      channelId: args.channelId,
      deliveryId: this.idGenerator(),
      memberHandle: m.handle,
      startedAt,
      state: 'queued',
      toolCallCount: 0,
      turnId,
    }))
    const turn: Turn = {
      author: {handle: 'you', kind: 'local-user'},
      channelId: args.channelId,
      idempotencyKey: args.idempotencyKey,
      mentions: allHandles,
      promptBlocks,
      promptedBy: 'user',
      startedAt,
      state: 'pending',
      turnId,
    }

    // Step 9: emit `turn_state_change pending → dispatched`.
    assertLegalTurnTransition('pending', 'dispatched')
    turn.state = 'dispatched'
    await this.persistAndBroadcast(args.channelId, args.projectRoot, turnId, {
      channelId: args.channelId,
      deliveryId: null,
      emittedAt: this.clock().toISOString(),
      from: 'pending',
      kind: 'turn_state_change',
      memberHandle: null,
      seq: this.seqAllocator.next({channelId: args.channelId, turnId}),
      to: 'dispatched',
      turnId,
    })

    // Track the in-flight turn so cancel/fan-out can introspect.
    const active: ActiveTurn = {
      cancelling: false,
      channelId: args.channelId,
      deliveries,
      members,
      projectRoot: args.projectRoot,
      turn,
    }
    this.activeTurns.set(turnId, active)

    // Step 10: emit `delivery_state_change queued → dispatched` for the
    // first `maxParallel` deliveries; the rest stay `queued` and are
    // released as in-flight deliveries reach terminal state.
    const inFlight: Array<{delivery: TurnDelivery; member: ChannelMember}> = []
    for (let i = 0; i < deliveries.length && i < maxParallel; i += 1) {
      const delivery = deliveries[i]
      delivery.state = 'dispatched'
      // eslint-disable-next-line no-await-in-loop
      await this.persistAndBroadcast(args.channelId, args.projectRoot, turnId, {
        channelId: args.channelId,
        deliveryId: delivery.deliveryId,
        emittedAt: this.clock().toISOString(),
        from: 'queued',
        kind: 'delivery_state_change',
        memberHandle: delivery.memberHandle,
        seq: this.seqAllocator.next({channelId: args.channelId, turnId}),
        to: 'dispatched',
        turnId,
      })
      inFlight.push({delivery, member: members[i]})
    }

    // Step 11–13: kick off one background streaming task per in-flight
    // delivery. Each task, on terminal, releases the next queued delivery.
    for (const {delivery, member} of inFlight) {
      this.runBackgroundStreaming(active, member, delivery, promptBlocks).catch(() => {
        // Background errors surface via delivery_state_change → errored.
      })
    }

    // Step 13: return synchronously with the snapshot — dispatched/queued
    // states as set above.
    return {deliveries, turn}
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

    return result.deliveries === undefined
      ? {events: result.events, turn: result.turn}
      : {deliveries: result.deliveries, events: result.events, turn: result.turn}
  }

  // ─── Phase-2 invite/uninvite ──────────────────────────────────────────

  async inviteMember(args: InviteMemberArgs): Promise<ChannelMember> {
    if (args.profileName !== undefined && args.invocation !== undefined) {
      throw new ChannelInvalidRequestError(
        'channel:invite accepts profileName OR invocation, not both',
        {fields: ['profileName', 'invocation']},
      )
    }

    // Resolve invocation + classification: Phase 3 reads profileName via the
    // driver-profile registry; Phase 2's inline invocation flow still works.
    let invocation: AgentDriverProfileInvocation
    let driverClass: 'A' | 'B' | 'C-prime' = 'C-prime'
    let inviteCapabilities: string[] = []
    if (args.profileName !== undefined) {
      if (this.profileStore === undefined) {
        throw new ChannelInvalidRequestError(
          'channel:invite by profileName requires the daemon to be running with the Phase-3 driver-profile registry wired in',
          {phase: 3},
        )
      }

      const profile = await this.profileStore.get(args.profileName)
      if (profile === undefined) {
        throw new AgentDriverProfileNotFoundError(args.profileName)
      }

      invocation = profile.invocation
      driverClass = profile.driverClass
      inviteCapabilities = [...(profile.capabilities ?? [])]
    } else if (args.invocation === undefined) {
      throw new ChannelInvalidRequestError(
        'channel:invite requires profileName OR invocation',
        {fields: ['profileName', 'invocation']},
      )
    } else {
      invocation = args.invocation
    }

    // Spawn driver + run initialize synchronously. Failure does NOT persist.
    const driver = this.driverFactory(invocation, args.handle)
    await driver.start()

    const member: ChannelMemberAcpAgent = {
      acpVersion: driver.protocolVersion === undefined ? undefined : String(driver.protocolVersion),
      agentName: args.handle,
      // Dedupe — profile.capabilities and driver.capabilities are populated
      // from the same source (the agent's `initialize` advertisement) so a
      // Phase-3 invite-by-profile flow doubles every cap. The Set preserves
      // first-seen order which matches the prior concatenation order.
      capabilities: [
        ...new Set([...(args.capabilities ?? []), ...driver.capabilities, ...inviteCapabilities]),
      ],
      driverClass,
      handle: args.handle,
      invocation,
      joinedAt: this.clock().toISOString(),
      memberKind: 'acp-agent',
      status: 'idle',
    }

    try {
      await this.store.updateChannelMeta({
        channelId: args.channelId,
        mutate: (meta) => {
          // Replace any prior member with the same handle.
          const existing = meta.members.filter((m) => m.handle !== args.handle)
          return {...meta, members: [...existing, member], updatedAt: this.clock().toISOString()}
        },
        projectRoot: args.projectRoot,
      })
    } catch (error) {
      // Failed to persist → stop the driver, propagate.
      await driver.stop()
      if (error instanceof Error && /not found/i.test(error.message)) {
        throw new ChannelNotFoundError(args.channelId)
      }

      throw error
    }

    this.pool.register({channelId: args.channelId, driver})
    this.broadcaster.broadcastToChannel(args.channelId, ChannelEvents.MEMBER_UPDATE, {
      channelId: args.channelId,
      member,
      op: 'added',
    })

    return member
  }

  async listChannels(args: ListChannelsArgs): Promise<Channel[]> {
    return this.store.listChannels({
      includeArchived: args.archived === true,
      projectRoot: args.projectRoot,
    })
  }

  async listTurns(args: ListTurnsArgs): Promise<ListTurnsResult> {
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

  // ─── Phase-2 permission decision ──────────────────────────────────────

  async permissionDecision(args: PermissionDecisionArgs): Promise<TurnEvent> {
    const active = this.activeTurns.get(args.turnId)
    if (active === undefined || active.channelId !== args.channelId) {
      throw new ChannelTurnNotFoundError(args.channelId, args.turnId)
    }

    const result = await this.permissionBroker.resolve({
      channelId: args.channelId,
      outcome: args.outcome,
      permissionRequestId: args.permissionRequestId,
      turnId: args.turnId,
    })

    const delivery = active.deliveries.find((d) => d.deliveryId === result.deliveryId)
    const memberHandle = delivery?.memberHandle ?? '@unknown'

    // Emit permission_decision event.
    const decisionSeq = this.seqAllocator.next({channelId: args.channelId, turnId: args.turnId})
    const decisionEvent: TurnEvent = {
      channelId: args.channelId,
      deliveryId: result.deliveryId,
      emittedAt: this.clock().toISOString(),
      kind: 'permission_decision',
      memberHandle,
      outcome: args.outcome,
      permissionRequestId: args.permissionRequestId,
      seq: decisionSeq,
      turnId: args.turnId,
    }
    await this.persistAndBroadcast(args.channelId, args.projectRoot, args.turnId, decisionEvent)

    // Emit delivery_state_change (awaiting_permission → streaming or cancelled).
    if (delivery !== undefined && delivery.state === 'awaiting_permission') {
      const to: TurnDelivery['state'] = result.isCancellation ? 'cancelled' : 'streaming'
      delivery.state = to
      await this.persistAndBroadcast(args.channelId, args.projectRoot, args.turnId, {
        channelId: args.channelId,
        deliveryId: result.deliveryId,
        emittedAt: this.clock().toISOString(),
        from: 'awaiting_permission',
        kind: 'delivery_state_change',
        memberHandle,
        seq: this.seqAllocator.next({channelId: args.channelId, turnId: args.turnId}),
        to,
        turnId: args.turnId,
      })
    }

    return decisionEvent
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
    await this.persistAndBroadcast(args.channelId, args.projectRoot, turnId, messageEvent)

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
    await this.persistAndBroadcast(args.channelId, args.projectRoot, turnId, stateChange)

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

  async uninviteMember(args: UninviteMemberArgs): Promise<ChannelMember> {
    const meta = await this.store.readChannelMeta({
      channelId: args.channelId,
      projectRoot: args.projectRoot,
    })
    if (meta === undefined) throw new ChannelNotFoundError(args.channelId)

    const existing = meta.members.find((m) => m.handle === args.memberHandle)
    if (existing === undefined) {
      throw new ChannelInvalidRequestError(`No member ${args.memberHandle} to uninvite`, {
        handle: args.memberHandle,
      })
    }

    // Cancel any in-flight deliveries for this member.
    for (const [turnId, active] of this.activeTurns) {
      const delivery = active.deliveries.find(
        (d) => d.memberHandle === args.memberHandle && NON_TERMINAL_DELIVERY_STATES.has(d.state),
      )
      if (delivery === undefined) continue
      // eslint-disable-next-line no-await-in-loop
      await this.cancelTurn({channelId: args.channelId, deliveryId: delivery.deliveryId, projectRoot: args.projectRoot, turnId})
    }

    await this.pool.release({channelId: args.channelId, memberHandle: args.memberHandle})

    await this.store.updateChannelMeta({
      channelId: args.channelId,
      mutate: (m) => ({
        ...m,
        members: m.members.filter((mem) => mem.handle !== args.memberHandle),
        updatedAt: this.clock().toISOString(),
      }),
      projectRoot: args.projectRoot,
    })

    this.broadcaster.broadcastToChannel(args.channelId, ChannelEvents.MEMBER_UPDATE, {
      channelId: args.channelId,
      member: existing,
      op: 'removed',
    })

    return existing
  }

  // ─── private helpers ──────────────────────────────────────────────────

  private async fetchPriorTurns(args: {
    channelId: string
    currentTurnId: string
    projectRoot: string
  }): Promise<Array<{events: TurnEvent[]; turn: Turn}>> {
    const list = await this.store.listTurns({channelId: args.channelId, projectRoot: args.projectRoot})
    const out: Array<{events: TurnEvent[]; turn: Turn}> = []
    for (const turn of list.turns) {
      if (turn.turnId === args.currentTurnId) continue
      // eslint-disable-next-line no-await-in-loop
      const full = await this.store.readTurn({channelId: args.channelId, projectRoot: args.projectRoot, turnId: turn.turnId})
      if (full !== undefined) out.push({events: full.events, turn: full.turn})
    }

    // listTurns returns most-recent-first; the lookback builder takes the
    // tail (last N), so reverse to oldest-first.
    return out.reverse()
  }

  private async finaliseTurn(active: ActiveTurn): Promise<void> {
    // Idempotency guard: cancelTurn and the background streaming task can
    // race to call finaliseTurn (both observe `activeTurns.has(turnId)`
    // true before either calls writeTurnSnapshot). Removing the entry
    // BEFORE any await ensures only one caller proceeds to disk writes.
    if (!this.activeTurns.has(active.turn.turnId)) return
    this.activeTurns.delete(active.turn.turnId)

    // Persist turn snapshot + delivery snapshots + message body for each delivery.
    await this.store.writeTurnSnapshot({
      channelId: active.channelId,
      projectRoot: active.projectRoot,
      turn: active.turn,
      turnId: active.turn.turnId,
    })
    for (const delivery of active.deliveries) {
      // eslint-disable-next-line no-await-in-loop
      await this.store.writeDeliverySnapshot({
        channelId: active.channelId,
        delivery,
        deliveryId: delivery.deliveryId,
        projectRoot: active.projectRoot,
        turnId: active.turn.turnId,
      })
    }

    this.seqAllocator.reset({channelId: active.channelId, turnId: active.turn.turnId})
  }

  private async handleDriverPayload(
    active: ActiveTurn,
    delivery: TurnDelivery,
    member: ChannelMember,
    payload: TurnEventPayload,
  ): Promise<void> {
    const {channelId} = active
    const {turnId} = active.turn
    const {projectRoot} = active

    // Transition delivery dispatched → streaming on the FIRST upstream event.
    if (delivery.state === 'dispatched') {
      delivery.state = 'streaming'
      await this.persistAndBroadcast(channelId, projectRoot, turnId, {
        channelId,
        deliveryId: delivery.deliveryId,
        emittedAt: this.clock().toISOString(),
        from: 'dispatched',
        kind: 'delivery_state_change',
        memberHandle: member.handle,
        seq: this.seqAllocator.next({channelId, turnId}),
        to: 'streaming',
        turnId,
      })
    }

    if (payload.kind === 'permission_request') {
      // Track in the broker BEFORE writing the event so a concurrent
      // permissionDecision finds the pending entry.
      const driver = this.pool.acquire({channelId, memberHandle: delivery.memberHandle})
      if (driver !== undefined) {
        this.permissionBroker.track({
          channelId,
          deliveryId: delivery.deliveryId,
          driver,
          memberHandle: delivery.memberHandle,
          permissionRequestId: payload.permissionRequestId,
          projectRoot,
          turnId,
        })
      }

      // delivery_state_change streaming → awaiting_permission.
      if (delivery.state === 'streaming') {
        delivery.state = 'awaiting_permission'
        await this.persistAndBroadcast(channelId, projectRoot, turnId, {
          channelId,
          deliveryId: delivery.deliveryId,
          emittedAt: this.clock().toISOString(),
          from: 'streaming',
          kind: 'delivery_state_change',
          memberHandle: member.handle,
          seq: this.seqAllocator.next({channelId, turnId}),
          to: 'awaiting_permission',
          turnId,
        })
      }
    }

    // Wrap the payload with TurnEventBase + seq.
    const wrapped = this.wrapPayload({channelId, delivery, memberHandle: member.handle, payload, turnId})
    await this.persistAndBroadcast(channelId, projectRoot, turnId, wrapped)
  }

  /**
   * Emit `turn_state_change dispatched → completed` + finalise snapshots
   * ONLY when every delivery has reached a terminal state. Multiple
   * background tasks may call this; the activeTurns Map gate ensures
   * we don't finalise twice.
   */
  private async maybeFinaliseTurn(active: ActiveTurn): Promise<void> {
    const {channelId} = active
    const {turnId} = active.turn
    const {projectRoot} = active
    if (!this.activeTurns.has(turnId)) return

    const allTerminal = active.deliveries.every((d) => !NON_TERMINAL_DELIVERY_STATES.has(d.state))
    if (!allTerminal) return

    if (active.turn.state === 'dispatched') {
      active.turn.state = 'completed'
      active.turn.endedAt = this.clock().toISOString()
      await this.persistAndBroadcast(channelId, projectRoot, turnId, {
        channelId,
        deliveryId: null,
        emittedAt: active.turn.endedAt,
        from: 'dispatched',
        kind: 'turn_state_change',
        memberHandle: null,
        seq: this.seqAllocator.next({channelId, turnId}),
        to: 'completed',
        turnId,
      })
    }

    await this.finaliseTurn(active)
  }

  private async persistAndBroadcast(
    channelId: string,
    projectRoot: string,
    turnId: string,
    event: TurnEvent,
  ): Promise<void> {
    await this.store.appendTurnEvent({channelId, event, projectRoot, turnId})
    this.broadcaster.broadcastToChannel(channelId, ChannelEvents.TURN_EVENT, {channelId, event})
  }

  /**
   * Fan-out scheduler: when an in-flight delivery reaches a terminal
   * state, find the next `queued` delivery (FIFO order matches mention
   * order from {@link parseMentions}) and dispatch it.
   */
  private async releaseNextQueued(active: ActiveTurn, normalisedPromptBlocks: ContentBlock[]): Promise<void> {
    // Race guard: if cancelTurn has begun, do not dispatch new deliveries.
    // The cancel coordinator's existing loop is responsible for emitting
    // `queued → cancelled` events for every remaining queued delivery.
    if (active.cancelling) return
    const next = active.deliveries.find((d) => d.state === 'queued')
    if (next === undefined) return
    const member = active.members.find((m) => m.handle === next.memberHandle)
    if (member === undefined) {
      next.state = 'errored'
      return
    }

    next.state = 'dispatched'
    await this.persistAndBroadcast(active.channelId, active.projectRoot, active.turn.turnId, {
      channelId: active.channelId,
      deliveryId: next.deliveryId,
      emittedAt: this.clock().toISOString(),
      from: 'queued',
      kind: 'delivery_state_change',
      memberHandle: next.memberHandle,
      seq: this.seqAllocator.next({channelId: active.channelId, turnId: active.turn.turnId}),
      to: 'dispatched',
      turnId: active.turn.turnId,
    })

    // Fire-and-forget — errors surface via delivery_state_change → errored.
    this.runBackgroundStreaming(active, member, next, normalisedPromptBlocks).catch(() => {})
  }

  private async runBackgroundStreaming(
    active: ActiveTurn,
    member: ChannelMember,
    delivery: TurnDelivery,
    normalisedPromptBlocks: ContentBlock[],
  ): Promise<void> {
    const {channelId} = active
    const {turnId} = active.turn
    const {projectRoot} = active

    const driver = this.pool.acquire({channelId, memberHandle: member.handle})
    if (driver === undefined) {
      delivery.state = 'errored'
      // Don't tear down the whole turn — other deliveries may still be running.
      await this.maybeFinaliseTurn(active)
      return
    }

    // Build lookback prefix (capability-gated). Fetch the channel's prior
    // turns from the store so the renderer has actual context to fold in.
    const acpMember = member.memberKind === 'acp-agent' ? member : undefined
    const capabilities = acpMember?.capabilities ?? []
    const priorTurns = await this.fetchPriorTurns({channelId, currentTurnId: turnId, projectRoot})
    const lookback = buildLookback({
      capabilities,
      channelId,
      normalisedPromptBlocks,
      priorTurns,
    })

    const envelope = {
      author: active.turn.author,
      channelId,
      deliveryId: delivery.deliveryId,
      lookbackDigest: lookback.digest,
      members: [],
      mentions: active.turn.mentions,
      schemaVersion: '1',
      turnId,
    }

    try {
      const iterator = driver.prompt({
        meta: {_meta: {'brv.channel': envelope}},
        prompt: lookback.blocks,
        turnId,
      })

      for await (const payload of iterator) {
         
        await this.handleDriverPayload(active, delivery, member, payload)
      }

      // Driver returned normally → delivery completed.
      if (NON_TERMINAL_DELIVERY_STATES.has(delivery.state)) {
        const from = delivery.state
        delivery.state = 'completed'
        await this.persistAndBroadcast(channelId, projectRoot, turnId, {
          channelId,
          deliveryId: delivery.deliveryId,
          emittedAt: this.clock().toISOString(),
          from,
          kind: 'delivery_state_change',
          memberHandle: member.handle,
          seq: this.seqAllocator.next({channelId, turnId}),
          to: 'completed',
          turnId,
        })
      }
    } catch (error) {
      // Background-task error path: mark delivery errored, do NOT propagate.
      const reason = error instanceof Error ? error.message : String(error)
      const promptError = new AcpPromptFailedError(reason)
      if (NON_TERMINAL_DELIVERY_STATES.has(delivery.state)) {
        const from = delivery.state
        delivery.state = 'errored'
        delivery.errorCode = promptError.code
        delivery.errorMessage = promptError.message
        await this.persistAndBroadcast(channelId, projectRoot, turnId, {
          channelId,
          deliveryId: delivery.deliveryId,
          emittedAt: this.clock().toISOString(),
          error: promptError.message,
          from,
          kind: 'delivery_state_change',
          memberHandle: member.handle,
          seq: this.seqAllocator.next({channelId, turnId}),
          to: 'errored',
          turnId,
        })
      }
    }

    // If the cancel coordinator already finalised the turn, skip.
    if (!this.activeTurns.has(turnId)) return

    // Fan-out: release the next queued delivery, if any.
    await this.releaseNextQueued(active, normalisedPromptBlocks)

    // Try to finalise — only when every delivery is terminal.
    await this.maybeFinaliseTurn(active)
  }

  private wrapPayload(args: {
    channelId: string
    delivery: TurnDelivery
    memberHandle: string
    payload: TurnEventPayload
    turnId: string
  }): TurnEvent {
    const base = {
      channelId: args.channelId,
      deliveryId: args.delivery.deliveryId,
      emittedAt: this.clock().toISOString(),
      memberHandle: args.memberHandle,
      seq: this.seqAllocator.next({channelId: args.channelId, turnId: args.turnId}),
      turnId: args.turnId,
    } as const
    return {...args.payload, ...base} as TurnEvent
  }
}
