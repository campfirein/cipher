import type {TurnEvent} from '../../shared/types/channel.js'

import {
  countDedupKey,
  isTerminalDeliveryEvent,
  isTerminalTurnEvent,
  matchesFilter,
  replayDedupKey,
  type SubscribeFilter,
} from './channel-subscribe-helpers.js'

// Slice 8.9 — extracted from `channel subscribe` so the
// buffer / dedup / termination orchestration is unit-testable without
// spinning up a daemon. Codex impl-review R5 specifically asked for a
// fake-client test covering ordering, dedup, and lastSeen monotonicity.

export type TerminationReason = 'count' | 'terminal'

export type RouterOptions = {
  count?: number
  exitOnTerminal: boolean
  filter: SubscribeFilter
  onEmit: (event: TurnEvent) => void
  onTerminate?: (reason: TerminationReason) => void
}

export class ChannelSubscribeRouter {
  private cursor: undefined | {seq: number; turnId: string}
  // Live events that arrive while replay is in progress are buffered here and
  // drained after replay completes. Codex impl-review high-2: without the
  // buffer, a live seq=7 could be emitted before a replayed seq=4 and
  // lastSeen.seq would regress.
  private readonly liveBuffer: TurnEvent[] = []
  private readonly opts: RouterOptions
  private readonly printed = new Set<string>()
  private readonly quorumSeen = new Set<string>()
  private replaying = false
  private terminated = false

  public constructor(opts: RouterOptions) {
    this.opts = opts
  }

  public beginReplay(): void {
    this.replaying = true
  }

  // Drain buffered live events in arrival order, then flip out of replay mode
  // so subsequent live events emit directly.
  public finishReplay(): void {
    for (const event of this.liveBuffer) {
      if (this.terminated) break
      this.processEvent(event)
    }

    this.liveBuffer.length = 0
    this.replaying = false
  }

  public isTerminated(): boolean {
    return this.terminated
  }

  public lastSeen(): undefined | {seq: number; turnId: string} {
    return this.cursor
  }

  // Live event from the Socket.IO listener.
  public pushLive(event: TurnEvent): void {
    if (this.terminated) return
    if (this.replaying) {
      this.liveBuffer.push(event)
      return
    }

    this.processEvent(event)
  }

  // Historical event from a `channel:get-turn` request during replay.
  public pushReplay(event: TurnEvent): void {
    if (this.terminated) return
    this.processEvent(event)
  }

  private checkQuorumCount(event: TurnEvent): void {
    if (this.opts.count === undefined) return
    if (!isTerminalDeliveryEvent(event)) return
    const key = countDedupKey(event)
    if (key === undefined) return
    const memberOk =
      this.opts.filter.roles === undefined || this.opts.filter.roles.has(event.memberHandle ?? '')
    if (!memberOk) return
    this.quorumSeen.add(key)
    if (this.quorumSeen.size >= this.opts.count) this.terminate('count')
  }

  // Terminal-turn exit ignores --kinds/--roles by design (a turn either reached
  // terminal or it didn't). Still gated by --turn so an unrelated turn doesn't
  // fire it.
  private checkTurnTerminalExit(event: TurnEvent): void {
    if (!this.opts.exitOnTerminal) return
    if (!isTerminalTurnEvent(event)) return
    if (this.opts.filter.turn !== undefined && event.turnId !== this.opts.filter.turn) return
    this.terminate('terminal')
  }

  private emit(event: TurnEvent): boolean {
    if (!matchesFilter(event, this.opts.filter)) return false
    const key = replayDedupKey(event)
    if (this.printed.has(key)) return false
    this.printed.add(key)
    this.cursor = {seq: event.seq, turnId: event.turnId}
    this.opts.onEmit(event)
    return true
  }

  // Single entry point for both live and replay events post-buffering. Emits
  // first (so an event that passes the filter still appears in stdout even
  // when it triggers terminate), then runs termination checks. Quorum-count
  // is gated by the filter (it counts emitted terminal deliveries). Terminal
  // turn-exit bypasses --kinds/--roles by design (codex impl-review-2 medium)
  // but still respects --turn.
  private processEvent(event: TurnEvent): void {
    const emitted = this.emit(event)
    if (emitted) this.checkQuorumCount(event)
    this.checkTurnTerminalExit(event)
  }

  private terminate(reason: TerminationReason): void {
    if (this.terminated) return
    this.terminated = true
    this.opts.onTerminate?.(reason)
  }
}
