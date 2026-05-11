import {promises as fs} from 'node:fs'
import {dirname, join} from 'node:path'

import type {Channel, ChannelMeta} from '../../../shared/types/channel.js'
import type {
  ChannelStoreAppendEventArgs,
  ChannelStoreCreateArgs,
  ChannelStoreListArgs,
  ChannelStoreListTurnsArgs,
  ChannelStoreListTurnsResult,
  ChannelStoreReadArgs,
  ChannelStoreReadTurnArgs,
  ChannelStoreReadTurnResult,
  ChannelStoreSnapshotArgs,
  ChannelStoreUpdateMetaArgs,
  IChannelStore,
} from '../../core/interfaces/channel/i-channel-store.js'

import {ChannelMetaSchema} from '../../../shared/types/channel.js'
import {ChannelEventsWriter} from './storage/events-writer.js'
import {channelPaths} from './storage/paths.js'
import {ChannelSnapshotWriter} from './storage/snapshot-writer.js'
import {ChannelTreeReader} from './storage/tree-reader.js'
import {ChannelWriteSerializer} from './storage/write-serializer.js'

/**
 * Phase-1 concrete IChannelStore.
 *
 * Composes the storage primitives from Slice 1.3 (events writer, snapshot
 * writer, tree reader, per-key write lock) and adds two things on top:
 *
 *  - meta.json read/write (atomic-rename writes serialised per channel via
 *    the shared {@link ChannelWriteSerializer} so concurrent updates from
 *    different turns don't tear the file).
 *  - List operations (listChannels scans channelsRoot/; listTurns scans
 *    `turns/<turnId>/turn.json`).
 *
 * The store knows the on-disk shape; the orchestrator (Slice 1.4 sibling)
 * owns state-machine policy, broadcasts, and id generation.
 */
export type ChannelStoreDeps = {
  readonly eventsWriter: ChannelEventsWriter
  readonly snapshotWriter: ChannelSnapshotWriter
  readonly treeReader: ChannelTreeReader
  readonly writeSerializer: ChannelWriteSerializer
}

const metaLockKey = (channelId: string): string => `meta:${channelId}`

const writeAtomically = async (target: string, contents: string): Promise<void> => {
  await fs.mkdir(dirname(target), {recursive: true})
  const tmp = `${target}.tmp.${process.pid}.${Date.now()}`
  await fs.writeFile(tmp, contents, {encoding: 'utf8'})
  await fs.rename(tmp, target)
}

const toChannelProjection = (meta: ChannelMeta): Channel => ({
  archivedAt: meta.archivedAt,
  channelId: meta.channelId,
  createdAt: meta.createdAt,
  memberCount: meta.members.length,
  members: meta.members.map((m) => ({
    capabilities: m.memberKind === 'acp-agent' ? m.capabilities : undefined,
    displayName:
      m.memberKind === 'human-messaging' ? m.displayName : m.memberKind === 'acp-agent' ? m.agentName : undefined,
    handle: m.handle,
    memberKind: m.memberKind,
    status: m.status,
  })),
  settings: meta.settings,
  title: meta.title,
  updatedAt: meta.updatedAt,
})

const tryReadMeta = async (path: string): Promise<ChannelMeta | undefined> => {
  try {
    const raw = await fs.readFile(path, 'utf8')
    return ChannelMetaSchema.parse(JSON.parse(raw))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export class ChannelStore implements IChannelStore {
  private readonly eventsWriter: ChannelEventsWriter
  private readonly snapshotWriter: ChannelSnapshotWriter
  private readonly treeReader: ChannelTreeReader
  private readonly writeSerializer: ChannelWriteSerializer

  public constructor(deps: ChannelStoreDeps) {
    this.eventsWriter = deps.eventsWriter
    this.snapshotWriter = deps.snapshotWriter
    this.treeReader = deps.treeReader
    this.writeSerializer = deps.writeSerializer
  }

  async appendTurnEvent(args: ChannelStoreAppendEventArgs): Promise<void> {
    await this.eventsWriter.append({
      channelId: args.channelId,
      event: args.event,
      projectRoot: args.projectRoot,
      turnId: args.turnId,
    })
  }

  async createChannel(args: ChannelStoreCreateArgs): Promise<Channel> {
    const {meta, projectRoot} = args
    return this.writeSerializer.withLock(metaLockKey(meta.channelId), async () => {
      const target = channelPaths.metaFile(projectRoot, meta.channelId)
      const existing = await tryReadMeta(target)
      if (existing !== undefined) {
        throw new Error(`Channel ${meta.channelId} already exists`)
      }

      await writeAtomically(target, JSON.stringify(meta, undefined, 2))
      return toChannelProjection(meta)
    })
  }

  async listChannels(args: ChannelStoreListArgs): Promise<Channel[]> {
    const root = channelPaths.channelsRoot(args.projectRoot)
    let entries: string[]
    try {
      entries = await fs.readdir(root)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }

    const metas = await Promise.all(
      entries.map((id) => tryReadMeta(channelPaths.metaFile(args.projectRoot, id))),
    )
    const channels: Channel[] = []
    for (const meta of metas) {
      if (meta === undefined) continue
      if (!args.includeArchived && meta.archivedAt !== undefined) continue
      channels.push(toChannelProjection(meta))
    }

    return channels.sort((a, b) => a.channelId.localeCompare(b.channelId))
  }

  async listTurns(args: ChannelStoreListTurnsArgs): Promise<ChannelStoreListTurnsResult> {
    const turnsRoot = join(channelPaths.channelDir(args.projectRoot, args.channelId), 'turns')
    let entries: string[]
    try {
      entries = await fs.readdir(turnsRoot)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {turns: []}
      throw error
    }

    const records = (
      await Promise.all(
        entries.map((turnId) =>
          this.treeReader.readTurn({
            channelId: args.channelId,
            projectRoot: args.projectRoot,
            turnId,
          }),
        ),
      )
    ).filter((r): r is NonNullable<typeof r> => r !== undefined)

    // Phase 1: order by startedAt descending (most recent first). Phase 2's
    // cursor pagination will switch to a stable seq-based cursor.
    records.sort((a, b) => b.startedAt.localeCompare(a.startedAt))

    const limit = args.limit ?? records.length
    const limited = records.slice(0, limit)

    return {turns: limited}
  }

  async readChannel(args: ChannelStoreReadArgs): Promise<Channel | undefined> {
    const target = channelPaths.metaFile(args.projectRoot, args.channelId)
    const meta = await tryReadMeta(target)
    return meta === undefined ? undefined : toChannelProjection(meta)
  }

  async readTurn(args: ChannelStoreReadTurnArgs): Promise<ChannelStoreReadTurnResult | undefined> {
    const turn = await this.treeReader.readTurn({
      channelId: args.channelId,
      projectRoot: args.projectRoot,
      turnId: args.turnId,
    })
    if (turn === undefined) return undefined

    const events = await this.treeReader.readEvents({
      channelId: args.channelId,
      projectRoot: args.projectRoot,
      turnId: args.turnId,
    })

    return {events, turn}
  }

  async updateChannelMeta(args: ChannelStoreUpdateMetaArgs): Promise<Channel> {
    const {channelId, mutate, projectRoot} = args
    return this.writeSerializer.withLock(metaLockKey(channelId), async () => {
      const target = channelPaths.metaFile(projectRoot, channelId)
      const existing = await tryReadMeta(target)
      if (existing === undefined) {
        throw new Error(`Channel ${channelId} not found`)
      }

      const next = ChannelMetaSchema.parse(mutate(existing))
      await writeAtomically(target, JSON.stringify(next, undefined, 2))
      return toChannelProjection(next)
    })
  }

  async writeTurnSnapshot(args: ChannelStoreSnapshotArgs): Promise<void> {
    await this.snapshotWriter.writeTurnSnapshot({
      channelId: args.channelId,
      projectRoot: args.projectRoot,
      turn: args.turn,
      turnId: args.turnId,
    })
  }
}
