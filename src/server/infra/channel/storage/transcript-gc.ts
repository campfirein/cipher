import {promises as fs} from 'node:fs'

import {ChannelTurnIndexStore} from './index-store.js'
import {channelPaths} from './paths.js'
import {ChannelWriteSerializer} from './write-serializer.js'

/**
 * Slice 9.4 — periodic GC sweep over the per-channel transcript mount.
 *
 * Removes per-turn `<turnId>.ndjson` files whose materialised index
 * entry shows the turn reached terminal state more than `retentionDays`
 * ago, then compacts the per-channel `index.jsonl` to drop the removed
 * entries.
 *
 * Locked design decisions from the codex + kimi parallel review:
 *   Q5 — 30-day default, configurable via env var. `retentionDays = 0`
 *        disables the sweep entirely (no destructive delete-now mode in
 *        this slice; that's an explicit `brv channel history prune`
 *        follow-up).
 *   Q8 (kimi) — GC MUST exclude active turns. The predicate requires
 *        `turn.endedAt != null && endedAt < now - retention`. An
 *        in-flight turn (no endedAt) is never reaped, regardless of how
 *        long it has been alive — Slice 9.2's held-open write streams
 *        can keep a single turn alive for hours, so the wall-clock-only
 *        predicate from typical TTL stores would corrupt streaming
 *        agent runs.
 *   Q8 (codex) — GC coordinates with active readers/writers via the
 *        per-turn write-lock. Acquiring the lock before unlink gives
 *        any in-flight `appendRawLine` (snapshot writes) or
 *        `closeStreamForTurn` calls a chance to complete first.
 *   2PC-gap (kimi) — index compaction is via temp+rename, atomic at
 *        the filesystem layer; a crash mid-rewrite leaves the original
 *        index intact.
 *
 * NOT in this slice: legacy `.brv/context-tree/channel/<id>/turns/`
 * mount sweep. Defer to Slice 9.5 so this slice stays scope-limited
 * to the new mount where the index is authoritative.
 */

export type ChannelTranscriptGcOptions = {
  readonly clock?: () => Date
  readonly indexStore: ChannelTurnIndexStore
  readonly retentionDays: number
  readonly serializer: ChannelWriteSerializer
}

export type SweepChannelArgs = {
  readonly channelId: string
  readonly projectRoot: string
}

export type SweepChannelResult = {
  readonly deletedLegacyMount: number
  readonly deletedNewMount: number
  readonly remaining: number
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

const tryUnlink = async (path: string): Promise<boolean> => {
  try {
    await fs.unlink(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export class ChannelTranscriptGc {
  private readonly clock: () => Date
  private readonly indexStore: ChannelTurnIndexStore
  private readonly retentionDays: number
  private readonly serializer: ChannelWriteSerializer

  public constructor(options: ChannelTranscriptGcOptions) {
    this.clock = options.clock ?? (() => new Date())
    this.indexStore = options.indexStore
    this.retentionDays = options.retentionDays
    this.serializer = options.serializer
  }

  async sweepChannel(args: SweepChannelArgs): Promise<SweepChannelResult> {
    if (this.retentionDays <= 0) {
      // Sweep disabled — return current index size so callers can still
      // log the no-op cycle with useful counts.
      const entries = await this.indexStore.getEntries(args)
      return {deletedLegacyMount: 0, deletedNewMount: 0, remaining: entries.size}
    }

    const now = this.clock()
    const cutoff = now.getTime() - this.retentionDays * MS_PER_DAY
    const entries = await this.indexStore.getEntries(args)

    const toDelete: string[] = []
    for (const [turnId, entry] of entries) {
      const {endedAt} = entry.turn
      if (endedAt === undefined) continue
      const endedMs = Date.parse(endedAt)
      if (Number.isNaN(endedMs)) continue
      // Inclusive boundary: a turn that ended exactly `retentionDays`
      // ago is NOT swept; only entries strictly older.
      if (endedMs >= cutoff) continue
      toDelete.push(turnId)
    }

    let deletedNewMount = 0
    for (const turnId of toDelete) {
      // Serialize with any in-flight writer or replay reader on the
      // same turn. The lock is released the moment the unlink syscall
      // returns, so this is at most a brief wait per turn.
      // eslint-disable-next-line no-await-in-loop
      await this.serializer.withLock(`${args.channelId}:${turnId}`, async () => {
        const file = channelPaths.turnNdjsonFile(args.projectRoot, args.channelId, turnId)
        await tryUnlink(file)
        deletedNewMount++
      })
    }

    if (toDelete.length > 0) {
      await this.indexStore.compactIndex({
        channelId: args.channelId,
        projectRoot: args.projectRoot,
        removedTurnIds: toDelete,
      })
    }

    const remaining = entries.size - deletedNewMount
    return {deletedLegacyMount: 0, deletedNewMount, remaining}
  }
}
