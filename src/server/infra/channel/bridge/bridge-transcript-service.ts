 
// Wire fields mirror IMPLEMENTATION_PHASE_9 §5.1 + §7.3 + channel
// transport schema; snake_case is intentional.

import type {
  ChannelMember,
  ChannelMemberRemotePeer,
  ContentBlock,
  Turn,
  TurnDelivery,
  TurnEvent,
} from '../../../../shared/types/channel.js'
import type {IChannelStore} from '../../../core/interfaces/channel/i-channel-store.js'
import type {ChannelEventsWriter} from '../storage/events-writer.js'

import { type PinState} from '../../../../agent/core/trust/tofu-store.js'

/**
 * Phase 9 / Slice 9.4e — Bob-side transcript persistence + auto-
 * provision matrix.
 *
 * When Alice's daemon sends a Parley query to Bob's daemon, Bob's
 * `parley-server` calls into this service to:
 *
 *   1. Resolve the auto-provision policy (per §7.3): decide whether
 *      Bob auto-creates a mirror channel for `envelope.channel_id`
 *      OR rejects the envelope with `CHANNEL_AUTO_PROVISION_DECLINED`.
 *   2. If accepted, write a turn record + Alice's prompt event to
 *      Bob's `events.jsonl`.
 *   3. As Bob's local agent emits response chunks, append each to the
 *      same turn's events file.
 *   4. On terminal frame, write the matching `delivery_state_change` +
 *      `turn_state_change` events so `brv channel show` on Bob's side
 *      surfaces the inbound conversation.
 *
 * Policy values:
 *   - `auto`        — accept all envelopes from authenticated peers
 *   - `pinned-only` — accept only `user-confirmed` or `ca-bound`
 *                     senders; reject `auto-tofu` first-contact peers
 *                     until the operator runs `brv trust verify`.
 *                     **Default.**
 *   - `deny`        — reject everything; Bob is read-only.
 *
 * Slice 9.4e does NOT yet implement `brv channel accept-remote-invite`
 * — operators must manually upgrade an `auto-tofu` peer to
 * `user-confirmed` (a future CLI surface) or set
 * `BRV_BRIDGE_AUTO_PROVISION=auto` to bypass.
 */

export type AutoProvisionPolicy = 'auto' | 'deny' | 'pinned-only'

export interface BridgeTranscriptServiceDeps {
  readonly autoProvisionPolicy: AutoProvisionPolicy
  readonly channelStore: IChannelStore
  readonly clock: () => Date
  readonly eventsWriter: ChannelEventsWriter
  readonly idGenerator: () => string
  /**
   * The project root under which bridge-inbound channels are
   * persisted (`<projectRoot>/.brv/context-tree/channel/<channelId>/`).
   * The daemon picks this at startup — typically `process.cwd()` of
   * the daemon process.
   */
  readonly projectRoot: string
}

export interface BeginTurnArgs {
  readonly channelId: string
  readonly prompt: readonly {readonly text: string; readonly type: 'text'}[]
  readonly senderDisplayHandle?: string
  readonly senderPeerId: string
  readonly senderPinState: PinState
  readonly turnId: string
}

export type BeginTurnResult =
  | {accepted: false; reason: string}
  | {accepted: true; deliveryId: string; mirrorHandle: string}

export class BridgeTranscriptService {
  private readonly autoProvisionPolicy: AutoProvisionPolicy
  private readonly channelStore: IChannelStore
  private readonly clock: () => Date
  private readonly eventsWriter: ChannelEventsWriter
  private readonly idGenerator: () => string
  // Per-turn context captured at beginTurn so finaliseTurn can write
  // the Turn snapshot with the same prompt the envelope delivered.
  private readonly inFlight = new Map<
    string,
    {
      deliveryId: string
      mirrorHandle: string
      promptBlocks: ContentBlock[]
      senderPeerId: string
      startedAt: string
    }
  >()
  private readonly projectRoot: string
  // Per-turn seq cursor. Mirrors the orchestrator's `seqAllocator`
  // pattern — strictly increasing seq within a turn, reset per turn.
  private readonly seqByTurn = new Map<string, number>()

  public constructor(deps: BridgeTranscriptServiceDeps) {
    this.autoProvisionPolicy = deps.autoProvisionPolicy
    this.channelStore = deps.channelStore
    this.clock = deps.clock
    this.eventsWriter = deps.eventsWriter
    this.idGenerator = deps.idGenerator
    this.projectRoot = deps.projectRoot
  }

  /**
   * Decide whether to accept the inbound turn (auto-provision policy
   * + handle resolution). When accepted, ensures the channel meta
   * exists (auto-creating + adding the sender as a mirror member if
   * needed), creates the turn record, and writes Alice's prompt as
   * the seq-0 message event.
   */
  public async beginTurn(args: BeginTurnArgs): Promise<BeginTurnResult> {
    if (!this.policyPermitsSender(args.senderPinState)) {
      return {
        accepted: false,
        reason: `auto_provision_policy="${this.autoProvisionPolicy}" rejects senders in pin_state="${args.senderPinState}"`,
      }
    }

    const mirrorHandle = this.mirrorHandleForPeer({
      displayHandle: args.senderDisplayHandle,
      peerId: args.senderPeerId,
    })

    // Ensure the channel meta exists. Auto-create if missing.
    await this.ensureChannelMeta({
      channelId: args.channelId,
      mirrorHandle,
      senderDisplayHandle: args.senderDisplayHandle,
      senderPeerId: args.senderPeerId,
    })

    // Append the inbound prompt as a seq-1 `message` event so
    // `brv channel show` surfaces it. The Turn record itself is
    // materialized at finalise via writeTurnSnapshot.
    const deliveryId = this.idGenerator()
    const promptText = args.prompt.map((b) => b.text).join('\n')
    const promptBlocks: ContentBlock[] = args.prompt.map((b) => ({text: b.text, type: 'text'}))
    await this.appendMessageEvent({
      channelId: args.channelId,
      content: promptText,
      deliveryId,
      memberHandle: mirrorHandle,
      role: 'user',
      turnId: args.turnId,
    })

    // Track the prompt blocks + delivery so finaliseTurn can build the
    // Turn snapshot with the same content the parley envelope carried.
    this.inFlight.set(`${args.channelId}\0${args.turnId}`, {
      deliveryId,
      mirrorHandle,
      promptBlocks,
      senderPeerId: args.senderPeerId,
      startedAt: this.clock().toISOString(),
    })

    return {accepted: true, deliveryId, mirrorHandle}
  }

  /**
   * Finalise the turn with the matching `delivery_state_change` +
   * `turn_state_change` events AND write the materialised Turn
   * snapshot so `brv channel show` can render it without replaying
   * events.
   */
  public async finaliseTurn(args: {
    channelId: string
    deliveryId: string
    endedState: 'completed' | 'errored'
    error?: {code: string; message: string}
    memberHandle: string
    turnId: string
  }): Promise<void> {
    const deliveryEvent: TurnEvent = {
      channelId: args.channelId,
      deliveryId: args.deliveryId,
      emittedAt: this.clock().toISOString(),
      from: 'streaming',
      kind: 'delivery_state_change',
      memberHandle: args.memberHandle,
      seq: this.nextSeq(args.channelId, args.turnId),
      to: args.endedState,
      turnId: args.turnId,
      ...(args.error === undefined ? {} : {error: args.error.message, errorCode: args.error.code}),
    }
    await this.eventsWriter.append({
      channelId: args.channelId,
      event: deliveryEvent,
      projectRoot: this.projectRoot,
      turnId: args.turnId,
    })

    const turnFinalState = args.endedState === 'completed' ? 'completed' : 'cancelled'
    const turnEvent: TurnEvent = {
      channelId: args.channelId,
      deliveryId: args.deliveryId,
      emittedAt: this.clock().toISOString(),
      from: 'dispatched',
      kind: 'turn_state_change',
      memberHandle: args.memberHandle,
      seq: this.nextSeq(args.channelId, args.turnId),
      to: turnFinalState,
      turnId: args.turnId,
    }
    await this.eventsWriter.append({
      channelId: args.channelId,
      event: turnEvent,
      projectRoot: this.projectRoot,
      turnId: args.turnId,
    })

    // Materialised Turn snapshot — enables `brv channel show` to skip
    // the events.jsonl replay path on Bob's side.
    const inFlight = this.inFlight.get(`${args.channelId}\0${args.turnId}`)
    if (inFlight !== undefined) {
      const endedAt = this.clock().toISOString()
      const turnSnapshot: Turn = {
        author: {handle: inFlight.mirrorHandle, kind: 'remote-peer' as never},
        channelId: args.channelId,
        endedAt,
        mentions: [],
        promptBlocks: inFlight.promptBlocks,
        promptedBy: 'user',
        startedAt: inFlight.startedAt,
        state: turnFinalState,
        turnId: args.turnId,
      }
      await this.channelStore.writeTurnSnapshot({
        channelId: args.channelId,
        projectRoot: this.projectRoot,
        turn: turnSnapshot,
        turnId: args.turnId,
      })

      const delivery: TurnDelivery = {
        artifactsTouched: [],
        channelId: args.channelId,
        deliveryId: args.deliveryId,
        endedAt,
        memberHandle: args.memberHandle,
        startedAt: inFlight.startedAt,
        state: args.endedState,
        toolCallCount: 0,
        turnId: args.turnId,
        ...(args.error === undefined
          ? {}
          : {errorCode: args.error.code, errorMessage: args.error.message}),
      }
      await this.channelStore.writeDeliverySnapshot({
        channelId: args.channelId,
        delivery,
        deliveryId: args.deliveryId,
        projectRoot: this.projectRoot,
        turnId: args.turnId,
      })
    }

    this.seqByTurn.delete(`${args.channelId}\0${args.turnId}`)
    this.inFlight.delete(`${args.channelId}\0${args.turnId}`)
    await this.channelStore.closeTranscriptStream({
      channelId: args.channelId,
      turnId: args.turnId,
    })
  }

  /** Record one response data chunk emitted by Bob's local agent. */
  public async recordChunk(args: {
    channelId: string
    chunk: {content: string; kind: 'agent_message_chunk' | 'agent_thought_chunk'}
    deliveryId: string
    memberHandle: string
    turnId: string
  }): Promise<void> {
    const seq = this.nextSeq(args.channelId, args.turnId)
    const event: TurnEvent = {
      channelId: args.channelId,
      content: args.chunk.content,
      deliveryId: args.deliveryId,
      emittedAt: this.clock().toISOString(),
      kind: args.chunk.kind,
      memberHandle: args.memberHandle,
      seq,
      turnId: args.turnId,
    }
    await this.eventsWriter.append({
      channelId: args.channelId,
      event,
      projectRoot: this.projectRoot,
      turnId: args.turnId,
    })
  }

  private async appendMessageEvent(args: {
    channelId: string
    content: string
    deliveryId: string
    memberHandle: string
    role: 'acp-agent' | 'human-messaging' | 'local-agent' | 'user'
    turnId: string
  }): Promise<void> {
    const event: TurnEvent = {
      channelId: args.channelId,
      content: args.content,
      deliveryId: args.deliveryId,
      emittedAt: this.clock().toISOString(),
      kind: 'message',
      memberHandle: args.memberHandle,
      role: args.role,
      seq: this.nextSeq(args.channelId, args.turnId),
      turnId: args.turnId,
    }
    await this.eventsWriter.append({
      channelId: args.channelId,
      event,
      projectRoot: this.projectRoot,
      turnId: args.turnId,
    })
  }

  private async ensureChannelMeta(args: {
    channelId: string
    mirrorHandle: string
    senderDisplayHandle?: string
    senderPeerId: string
  }): Promise<void> {
    const existing = await this.channelStore.readChannelMeta({
      channelId: args.channelId,
      projectRoot: this.projectRoot,
    })

    if (existing === undefined) {
      const now = this.clock().toISOString()
      const senderMember: ChannelMemberRemotePeer = {
        handle: args.mirrorHandle,
        joinedAt: now,
        memberKind: 'remote-peer',
        // The mirror member is the SENDER as seen from Bob's side.
        // multiaddr and remoteL2PubKey are not strictly required for
        // transcript display, but the schema requires them. We seed
        // with the peer_id-encoded suffix and the same pubkey Bob
        // already verified during the parley handshake. Operators
        // who want to MENTION this mirror member back (initiating a
        // reverse parley) need to manually `brv channel invite` with
        // real multiaddr from Alice's `bridge whoami`.
        multiaddr: `/p2p/${args.senderPeerId}`,
        peerId: args.senderPeerId,
        remoteL2PubKey: 'pending-discovery',
        status: 'idle',
        ...(args.senderDisplayHandle === undefined ? {} : {displayName: args.senderDisplayHandle}),
      }
      const meta = {
        channelId: args.channelId,
        createdAt: now,
        members: [senderMember] as ChannelMember[],
        updatedAt: now,
      }
      await this.channelStore.createChannel({
        meta,
        projectRoot: this.projectRoot,
      })
      return
    }

    // Channel exists — ensure the sender is a member, otherwise
    // add them. Idempotent: same handle does not duplicate.
    const alreadyMember = existing.members.some((m) => m.handle === args.mirrorHandle)
    if (alreadyMember) return
    await this.channelStore.updateChannelMeta({
      channelId: args.channelId,
      mutate: (meta) => ({
        ...meta,
        members: [
          ...meta.members,
          {
            handle: args.mirrorHandle,
            joinedAt: this.clock().toISOString(),
            memberKind: 'remote-peer',
            multiaddr: `/p2p/${args.senderPeerId}`,
            peerId: args.senderPeerId,
            remoteL2PubKey: 'pending-discovery',
            status: 'idle',
            ...(args.senderDisplayHandle === undefined ? {} : {displayName: args.senderDisplayHandle}),
          } satisfies ChannelMemberRemotePeer,
        ],
        updatedAt: this.clock().toISOString(),
      }),
      projectRoot: this.projectRoot,
    })
  }

  /**
   * Bob's local handle for the inbound peer. Always derives from the
   * sender's peer_id so it's deterministic + collision-free across
   * mentions. The L1 install-cert's `display_handle` (if any) is
   * surfaced as `displayName` on the member record for UI rendering.
   */
  private mirrorHandleForPeer(args: {displayHandle?: string; peerId: string}): string {
    return `@${args.peerId}`
  }

  private nextSeq(channelId: string, turnId: string): number {
    const key = `${channelId}\0${turnId}`
    const next = (this.seqByTurn.get(key) ?? 0) + 1
    this.seqByTurn.set(key, next)
    return next
  }

  private policyPermitsSender(pinState: PinState): boolean {
    if (this.autoProvisionPolicy === 'deny') return false
    if (this.autoProvisionPolicy === 'auto') return true
    // pinned-only: only user-confirmed and ca-bound peers can auto-
    // provision a channel on Bob's side. auto-tofu first-contact
    // peers are rejected until the operator promotes them via a
    // future `brv trust verify` flow.
    return pinState === 'user-confirmed' || pinState === 'ca-bound'
  }
}



export {type KnownPeer} from '../../../../agent/core/trust/tofu-store.js'