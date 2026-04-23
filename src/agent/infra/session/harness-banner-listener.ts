/**
 * Listens on `harness:refinement-completed` per session. Buffers
 * accepted refinements; on session-end, prints a single banner
 * summarising the latest accepted refinement (if any).
 *
 * Suppression rules:
 *   - harnessEnabled === false → never print
 *   - isTty === false → never print
 *   - No accepted refinement in the session → never print
 *   - Multiple refinements → print only the last accepted
 */

import type {AgentEventMap} from '../../core/domain/agent-events/types.js'
import type {AgentEventBus} from '../events/event-emitter.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AcceptedRefinement = Extract<AgentEventMap['harness:refinement-completed'], {accepted: true}>

export type HarnessBannerListenerOptions = {
  readonly eventBus: AgentEventBus
  readonly harnessEnabled: boolean
  readonly isTty: boolean
  readonly writeLine: (s: string) => void
}

// ---------------------------------------------------------------------------
// HarnessBannerListener
// ---------------------------------------------------------------------------

export class HarnessBannerListener {
  private ended = false
  private readonly eventBus: AgentEventBus
  private readonly handleEvent = (event: AgentEventMap['harness:refinement-completed']): void => {
    if (event.accepted) {
      this.lastAccepted = event
    }
  }
  private readonly harnessEnabled: boolean
  private readonly isTty: boolean
  private lastAccepted: AcceptedRefinement | undefined
  private readonly writeLine: (s: string) => void

  constructor(opts: HarnessBannerListenerOptions) {
    this.eventBus = opts.eventBus
    this.writeLine = opts.writeLine
    this.isTty = opts.isTty
    this.harnessEnabled = opts.harnessEnabled
    this.eventBus.on('harness:refinement-completed', this.handleEvent)
  }

  /** Called by SessionManager on session end. Idempotent. */
  onSessionEnd(): void {
    if (this.ended) return
    this.ended = true
    this.eventBus.off('harness:refinement-completed', this.handleEvent)

    if (!this.harnessEnabled || !this.isTty || !this.lastAccepted) return

    const {fromHeuristic, fromVersion, toHeuristic, toVersion} = this.lastAccepted
    this.writeLine(
      `harness updated: v${fromVersion} → v${toVersion} (H: ${fromHeuristic.toFixed(2)} → ${toHeuristic.toFixed(2)})\n`,
    )
  }
}
