import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'
import type {ChannelOrchestrator} from '../../channel/orchestrator.js'
import type {TreeReader} from '../../channel/storage/tree-reader.js'
import type {TreeWriter} from '../../channel/storage/tree-writer.js'

import {
  type ChannelArchiveRequestT,
  type ChannelArchiveResponseT,
  type ChannelCancelRequestT,
  type ChannelCancelResponseT,
  type ChannelCreateRequestT,
  type ChannelCreateResponseT,
  ChannelEvents,
  type ChannelGetRequestT,
  type ChannelGetResponseT,
  type ChannelInviteRequestT,
  type ChannelInviteResponseT,
  type ChannelJoinRequestT,
  type ChannelJoinResponseT,
  type ChannelLeaveRequestT,
  type ChannelLeaveResponseT,
  type ChannelListResponseT,
  type ChannelMembersRequestT,
  type ChannelMembersResponseT,
  type ChannelMentionRequestT,
  type ChannelMentionResponseT,
  type ChannelMuteRequestT,
  type ChannelMuteResponseT,
} from '../../../../shared/transport/events/channel-events.js'
import {ChannelNotFoundError} from '../../../core/domain/channel/errors.js'

export interface ChannelHandlerDeps {
  orchestrator: ChannelOrchestrator
  reader: TreeReader
  transport: ITransportServer
  writer: TreeWriter
}

/**
 * Daemon-side handler for `channel:*` events (BRV-206).
 *
 * Each request handler is a thin wrapper over the `ChannelOrchestrator`
 * (turn lifecycle) or the tree I/O primitives (channel CRUD). The
 * orchestrator owns the in-process publish callback that emits
 * `ChannelEvents.TURN_EVENT` notifications; the cross-process subscription
 * transport that exposes those notifications to oclif consumers lands in
 * Phase 3 (BRV-221).
 */
export class ChannelHandler {
  private readonly orchestrator: ChannelOrchestrator
  private readonly reader: TreeReader
  private readonly transport: ITransportServer
  private readonly writer: TreeWriter

  constructor(deps: ChannelHandlerDeps) {
    this.orchestrator = deps.orchestrator
    this.reader = deps.reader
    this.transport = deps.transport
    this.writer = deps.writer
  }

  setup(): void {
    this.transport.onRequest<ChannelCreateRequestT, ChannelCreateResponseT>(
      ChannelEvents.CREATE,
      (data) => this.handleCreate(data),
    )
    this.transport.onRequest<void, ChannelListResponseT>(
      ChannelEvents.LIST,
      () => this.handleList(),
    )
    this.transport.onRequest<ChannelGetRequestT, ChannelGetResponseT>(
      ChannelEvents.GET,
      (data) => this.handleGet(data),
    )
    this.transport.onRequest<ChannelArchiveRequestT, ChannelArchiveResponseT>(
      ChannelEvents.ARCHIVE,
      (data) => this.handleArchive(data),
    )
    this.transport.onRequest<ChannelInviteRequestT, ChannelInviteResponseT>(
      ChannelEvents.INVITE,
      (data) => this.handleInvite(data),
    )
    this.transport.onRequest<ChannelLeaveRequestT, ChannelLeaveResponseT>(
      ChannelEvents.LEAVE,
      (data) => this.handleLeave(data),
    )
    this.transport.onRequest<ChannelMuteRequestT, ChannelMuteResponseT>(
      ChannelEvents.MUTE,
      (data) => this.handleMute(data),
    )
    this.transport.onRequest<ChannelMembersRequestT, ChannelMembersResponseT>(
      ChannelEvents.MEMBERS,
      (data) => this.handleMembers(data),
    )
    this.transport.onRequest<ChannelMentionRequestT, ChannelMentionResponseT>(
      ChannelEvents.MENTION,
      (data) => this.handleMention(data),
    )
    this.transport.onRequest<ChannelCancelRequestT, ChannelCancelResponseT>(
      ChannelEvents.CANCEL,
      (data) => this.handleCancel(data),
    )
    this.transport.onRequest<ChannelJoinRequestT, ChannelJoinResponseT>(
      ChannelEvents.JOIN,
      (data) => this.handleJoin(data),
    )
  }

  private async handleArchive(data: ChannelArchiveRequestT): Promise<ChannelArchiveResponseT> {
    const meta = await this.requireMeta(data.channelId)
    meta.status = 'archived'
    await this.writer.writeMeta(meta)
    return {meta}
  }

  private async handleCancel(_data: ChannelCancelRequestT): Promise<ChannelCancelResponseT> {
    // Phase 1: cancel API surface only — orchestrator-side cancel wiring lands in Phase 2
    // alongside real ACP drivers (the mock driver is fast enough that v1 tests don't need it).
    return {cancelled: false}
  }

  private async handleCreate(data: ChannelCreateRequestT): Promise<ChannelCreateResponseT> {
    const treeRoot = data.treeRootHint ?? process.cwd()
    const meta = {
      channelId: data.channelId,
      createdAt: new Date().toISOString(),
      members: [],
      scope: data.scope,
      status: 'active' as const,
      treeRoot,
      turnCount: 0,
    }
    await this.writer.ensureChannelDir(meta)
    await this.writer.writeMeta(meta)
    return {meta}
  }

  private async handleGet(data: ChannelGetRequestT): Promise<ChannelGetResponseT> {
    const meta = await this.reader.readMeta(data.channelId)
    return {meta: meta ?? null}
  }

  private async handleInvite(data: ChannelInviteRequestT): Promise<ChannelInviteResponseT> {
    const meta = await this.requireMeta(data.channelId)
    const existingIds = new Set(meta.members.map((member) => member.agentId))
    for (const agent of data.agents) {
      if (!existingIds.has(agent.id)) {
        meta.members.push({
          agentId: agent.id,
          joinedAt: new Date().toISOString(),
          status: 'idle',
        })
      }
    }

    await this.writer.writeMeta(meta)
    return {meta}
  }

  private async handleJoin(data: ChannelJoinRequestT): Promise<ChannelJoinResponseT> {
    await this.requireMeta(data.channelId)
    return {message: 'TUI ChannelView lands in Phase 3 (BRV-215..221).'}
  }

  private async handleLeave(data: ChannelLeaveRequestT): Promise<ChannelLeaveResponseT> {
    const meta = await this.requireMeta(data.channelId)
    const member = meta.members.find((m) => m.agentId === data.agentId)
    if (member) {
      member.status = 'left'
    }

    await this.writer.writeMeta(meta)
    return {meta}
  }

  private async handleList(): Promise<ChannelListResponseT> {
    const channels = await this.reader.listAllChannels()
    return {channels}
  }

  private async handleMembers(data: ChannelMembersRequestT): Promise<ChannelMembersResponseT> {
    const meta = await this.requireMeta(data.channelId)
    return {members: meta.members}
  }

  private async handleMention(data: ChannelMentionRequestT): Promise<ChannelMentionResponseT> {
    const turns = await this.orchestrator.mention(data)
    return {turns}
  }

  private async handleMute(data: ChannelMuteRequestT): Promise<ChannelMuteResponseT> {
    const meta = await this.requireMeta(data.channelId)
    const member = meta.members.find((m) => m.agentId === data.agentId)
    if (member) {
      member.status = data.muted ? 'muted' : 'idle'
    }

    await this.writer.writeMeta(meta)
    return {meta}
  }

  private async requireMeta(channelId: string) {
    const meta = await this.reader.readMeta(channelId)
    if (!meta) throw new ChannelNotFoundError(channelId)
    return meta
  }
}
