import {promises as fs} from 'node:fs'

import type {Turn, TurnDelivery, TurnEvent} from '../../../../shared/types/channel.js'

import {TurnSchema} from '../../../../shared/types/channel.js'
import {channelPaths} from './paths.js'

/**
 * Read side of the channel storage layer (CHANNEL_PROTOCOL.md §4.2).
 *
 * Two read APIs:
 *
 *  - {@link readEvents}: parse `events.jsonl` line-by-line into TurnEvents,
 *    skipping blank lines. Returns an empty array when the file is missing
 *    (the orchestrator interprets "no events" as "turn does not exist").
 *
 *  - {@link readTurn}: return the persisted `Turn` record. Tries the
 *    `turn.json` snapshot first; on miss-or-corrupt falls back to replaying
 *    `events.jsonl` and synthesising a minimal Turn from the events. This
 *    is the crash-recovery contract from Phase 1 DoD §2.
 *
 * Replay synthesis is intentionally minimal: it reconstructs `turnId`,
 * `channelId`, and the final `state` (last `turn_state_change` event).
 * Author / promptBlocks / startedAt come from the first message event when
 * the snapshot is gone; if events lack the data, fields are filled with safe
 * defaults so the orchestrator can still surface the turn to readers
 * (`brv channel show`) and resume from `events.jsonl` truth.
 *
 * Phase 2's mention path adds richer replay (per-delivery state, tool calls)
 * — Phase 1 only needs to reconstruct passive turns, which carry one
 * message event plus one turn_state_change.
 */

const FALLBACK_EMPTY_AUTHOR: Turn['author'] = {handle: 'you', kind: 'local-user'}

export type ReadEventsArgs = {
  readonly channelId: string
  readonly projectRoot: string
  readonly turnId: string
}

export type ReadTurnArgs = {
  readonly channelId: string
  readonly projectRoot: string
  readonly turnId: string
}

const tryReadFile = async (path: string): Promise<string | undefined> => {
  try {
    return await fs.readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

const parseEventLine = (line: string): TurnEvent | undefined => {
  if (line.trim() === '') return undefined
  try {
    return JSON.parse(line) as TurnEvent
  } catch {
    // A corrupt line shouldn't break replay of the rest of the file. Phase 2
    // can promote this to a structured warning; Phase 1 silently skips.
    return undefined
  }
}

export class ChannelTreeReader {
  async readEvents(args: ReadEventsArgs): Promise<TurnEvent[]> {
    const file = channelPaths.eventsFile(args.projectRoot, args.channelId, args.turnId)
    const raw = await tryReadFile(file)
    if (raw === undefined) return []

    const events: TurnEvent[] = []
    for (const line of raw.split('\n')) {
      const event = parseEventLine(line)
      if (event !== undefined) events.push(event)
    }

    // Events are written in seq order by the writer (single-writer per turn
    // via ChannelWriteSerializer), so the on-disk order already matches seq.
    // A defensive sort guards against external tooling tampering.
    events.sort((a, b) => a.seq - b.seq)
    return events
  }

  async readTurn(args: ReadTurnArgs): Promise<Turn | undefined> {
    const snapshotFile = channelPaths.turnSnapshotFile(args.projectRoot, args.channelId, args.turnId)
    const snapshotRaw = await tryReadFile(snapshotFile)

    if (snapshotRaw !== undefined) {
      try {
        const parsed = TurnSchema.parse(JSON.parse(snapshotRaw))
        return parsed
      } catch {
        // Fall through to events-replay on corrupt snapshot.
      }
    }

    const events = await this.readEvents(args)
    if (events.length === 0) return undefined

    return this.reconstructTurnFromEvents(args.channelId, args.turnId, events)
  }

  /**
   * Phase-2 replay path: walks `events.jsonl` once and emits one
   * {@link TurnDelivery} per distinct `deliveryId` seen on
   * `delivery_state_change` events, with the latest-observed state as the
   * current state. Returns `[]` when no delivery events exist (passive
   * Phase-1 turns).
   */
  async replayDeliveries(args: ReadEventsArgs): Promise<TurnDelivery[]> {
    const events = await this.readEvents(args)
    if (events.length === 0) return []

    type Accumulator = {
      firstEmittedAt: string
      lastEmittedAt: string
      memberHandle: string
      state: TurnDelivery['state']
    }
    const byDelivery = new Map<string, Accumulator>()

    for (const event of events) {
      if (event.kind !== 'delivery_state_change') continue
      const deliveryId = event.deliveryId ?? undefined
      if (deliveryId === undefined) continue
      const memberHandle = event.memberHandle ?? '@unknown'

      const existing = byDelivery.get(deliveryId)
      if (existing === undefined) {
        byDelivery.set(deliveryId, {
          firstEmittedAt: event.emittedAt,
          lastEmittedAt: event.emittedAt,
          memberHandle,
          state: event.to,
        })
      } else {
        existing.state = event.to
        existing.lastEmittedAt = event.emittedAt
      }
    }

    const TERMINAL_STATES = new Set<TurnDelivery['state']>(['cancelled', 'completed', 'errored'])
    const result: TurnDelivery[] = []
    for (const [deliveryId, acc] of byDelivery) {
      result.push({
        artifactsTouched: [],
        channelId: args.channelId,
        deliveryId,
        endedAt: TERMINAL_STATES.has(acc.state) ? acc.lastEmittedAt : undefined,
        memberHandle: acc.memberHandle,
        startedAt: acc.firstEmittedAt,
        state: acc.state,
        toolCallCount: 0,
        turnId: args.turnId,
      })
    }

    return result
  }

  private reconstructTurnFromEvents(
    channelId: string,
    turnId: string,
    events: TurnEvent[],
  ): Turn {
    const firstMessage = events.find((e): e is Extract<TurnEvent, {kind: 'message'}> => e.kind === 'message')
    const lastStateChange = [...events]
      .reverse()
      .find((e): e is Extract<TurnEvent, {kind: 'turn_state_change'}> => e.kind === 'turn_state_change')

    const startedAt = events[0]?.emittedAt ?? new Date(0).toISOString()
    // Phase 2: only terminal states carry endedAt. `dispatched` is non-terminal
    // (see CHANNEL_PROTOCOL.md §4.5 table), so an in-flight turn surfaces with
    // `endedAt: undefined` after replay.
    const state = lastStateChange?.to ?? 'pending'
    const TERMINAL: Turn['state'][] = ['completed', 'cancelled']
    const endedAt = TERMINAL.includes(state) ? lastStateChange?.emittedAt : undefined

    return {
      author: FALLBACK_EMPTY_AUTHOR,
      channelId,
      endedAt,
      mentions: [],
      promptBlocks: firstMessage === undefined ? [] : [{text: firstMessage.content, type: 'text'}],
      promptedBy: 'user',
      startedAt,
      state,
      turnId,
    }
  }
}
