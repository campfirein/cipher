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

  constructor(
    eventBus: AgentEventBus,
    writeLine: (s: string) => void,
    isTty: boolean,
    harnessEnabled: boolean,
  ) {
    this.eventBus = eventBus
    this.writeLine = writeLine
    this.isTty = isTty
    this.harnessEnabled = harnessEnabled
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
