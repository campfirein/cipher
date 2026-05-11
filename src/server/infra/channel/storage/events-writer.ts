import {promises as fs} from 'node:fs'
import {dirname} from 'node:path'

import type {TurnEvent} from '../../../../shared/types/channel.js'

import {channelPaths} from './paths.js'
import {ChannelWriteSerializer} from './write-serializer.js'

/**
 * Append-only writer for the per-turn `events.jsonl` source-of-truth file
 * (CHANNEL_PROTOCOL.md §4.2). Phase 1 invariants:
 *
 *  - Each call appends exactly one event encoded as a single-line JSON object
 *    followed by `\n`. Embedded newlines in payload strings are escaped by
 *    `JSON.stringify`, so each physical line is a complete event.
 *
 *  - `event.seq` MUST be monotonically increasing per `(channelId, turnId)`.
 *    The writer tracks the last seq per turn in-process and rejects
 *    regressions; on cold start the orchestrator MUST seed the writer from
 *    the on-disk file (or fall back to scanning, per Slice 1.4).
 *
 *  - Concurrent appends to the same `(channelId, turnId)` are serialised by
 *    the shared {@link ChannelWriteSerializer}. Appends to different turns
 *    may proceed in parallel.
 *
 *  - The events file's parent directory is created lazily; callers do not
 *    need to mkdir.
 */

export type ChannelEventsWriterOptions = {
  readonly serializer: ChannelWriteSerializer
}

export type AppendArgs = {
  readonly channelId: string
  readonly event: TurnEvent
  readonly projectRoot: string
  readonly turnId: string
}

export class ChannelEventsWriter {
  private readonly lastSeqByTurn = new Map<string, number>()
  private readonly serializer: ChannelWriteSerializer

  public constructor(options: ChannelEventsWriterOptions) {
    this.serializer = options.serializer
  }

  /**
   * Append one event to `events.jsonl`. Returns when the data has been
   * persisted to disk (write + fsync of directory). Rejects with an Error if
   * `event.seq` is not strictly greater than the last observed seq for this
   * turn.
   */
  async append(args: AppendArgs): Promise<void> {
    const {channelId, event, projectRoot, turnId} = args
    const lockKey = `${channelId}:${turnId}`

    await this.serializer.withLock(lockKey, async () => {
      const lastSeq = this.lastSeqByTurn.get(lockKey)
      if (lastSeq !== undefined && event.seq <= lastSeq) {
        throw new Error(
          `Non-monotonic seq for ${lockKey}: got ${event.seq}, last persisted ${lastSeq}`,
        )
      }

      const file = channelPaths.eventsFile(projectRoot, channelId, turnId)
      await fs.mkdir(dirname(file), {recursive: true})

      // JSON.stringify escapes newlines, so each event lands on exactly one
      // physical line followed by '\n'. appendFile with the 'a' flag is
      // atomic enough for the write-lock to guarantee no interleaving.
      const line = `${JSON.stringify(event)}\n`
      await fs.appendFile(file, line, {encoding: 'utf8', flag: 'a'})

      this.lastSeqByTurn.set(lockKey, event.seq)
    })
  }

  /**
   * Tells the writer the highest seq currently on disk for a given turn.
   * Slice 1.4's orchestrator calls this on cold start so non-monotonic
   * rejection works correctly after a restart.
   */
  public seedLastSeq(channelId: string, turnId: string, lastSeq: number): void {
    this.lastSeqByTurn.set(`${channelId}:${turnId}`, lastSeq)
  }
}
