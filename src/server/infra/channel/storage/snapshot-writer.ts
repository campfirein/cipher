import {promises as fs} from 'node:fs'
import {dirname} from 'node:path'

import type {Turn, TurnDelivery} from '../../../../shared/types/channel.js'

import {channelPaths} from './paths.js'

/**
 * One-shot finalisation snapshot writer (CHANNEL_PROTOCOL.md §4.2).
 *
 * `events.jsonl` is the source of truth; this writer emits derived caches
 * that make `brv channel show` cheap:
 *
 *  - `turn.json` (write-once per turn, at terminal state)
 *  - `deliveries/<deliveryId>.json` (write-once per delivery, at terminal state)
 *  - `messages/<deliveryId>.md` (write-once per delivery, at terminal state)
 *
 * All writes use atomic rename (`fs.writeFile` to a `.tmp.<pid>` sibling,
 * then `fs.rename`) so a crash mid-write leaves either the previous version
 * (if any) or no file at all — never a partial file. If the snapshot is
 * absent at read time, the tree-reader falls back to replaying
 * `events.jsonl`.
 *
 * The writer does NOT enforce write-once at the call site — callers (the
 * orchestrator's finaliseTurn / finaliseDelivery) MUST only invoke these
 * methods on terminal-state transitions. Per the design, multiple calls
 * with the same input are idempotent on the final file (last writer wins).
 */
export type WriteTurnSnapshotArgs = {
  readonly channelId: string
  readonly projectRoot: string
  readonly turn: Turn
  readonly turnId: string
}

export type WriteDeliverySnapshotArgs = {
  readonly channelId: string
  readonly delivery: TurnDelivery
  readonly deliveryId: string
  readonly projectRoot: string
  readonly turnId: string
}

export type WriteMessageArgs = {
  readonly body: string
  readonly channelId: string
  readonly deliveryId: string
  readonly projectRoot: string
  readonly turnId: string
}

const writeAtomically = async (target: string, contents: string): Promise<void> => {
  await fs.mkdir(dirname(target), {recursive: true})
  const tmp = `${target}.tmp.${process.pid}.${Date.now()}`
  await fs.writeFile(tmp, contents, {encoding: 'utf8'})
  await fs.rename(tmp, target)
}

export class ChannelSnapshotWriter {
  async writeDeliverySnapshot(args: WriteDeliverySnapshotArgs): Promise<void> {
    const {channelId, delivery, deliveryId, projectRoot, turnId} = args
    const target = channelPaths.deliverySnapshotFile(projectRoot, channelId, turnId, deliveryId)
    await writeAtomically(target, JSON.stringify(delivery, undefined, 2))
  }

  async writeMessage(args: WriteMessageArgs): Promise<void> {
    const {body, channelId, deliveryId, projectRoot, turnId} = args
    const target = channelPaths.messageFile(projectRoot, channelId, turnId, deliveryId)
    await writeAtomically(target, body)
  }

  async writeTurnSnapshot(args: WriteTurnSnapshotArgs): Promise<void> {
    const {channelId, projectRoot, turn, turnId} = args
    const target = channelPaths.turnSnapshotFile(projectRoot, channelId, turnId)
    await writeAtomically(target, JSON.stringify(turn, undefined, 2))
  }
}
