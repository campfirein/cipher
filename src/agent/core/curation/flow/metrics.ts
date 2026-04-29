/**
 * Curate-flow metrics collector.
 *
 * Captures per-node timings and fallback signals during a single curate run.
 * Phase 1 ships the data-shape only; daemon event-bus wire-up arrives in
 * Phase 4 alongside `OutcomeRecorder` (see plan/agent-driven-graph/PLAN.md §5).
 */

import {NODE_SLOT_ORDER, type NodeSlot} from './types.js'

export interface CurateFlowRunEvent {
  fallbacksTriggered: string[]
  /**
   * Per-slot timings in milliseconds. ALL slots are present (zero-filled
   * to 0 for slots that did not run) so downstream event consumers can
   * rely on `Record<NodeSlot, number>` shape without defensive lookups.
   * See PHASE-1-IMPLEMENTATION.md Task 1.4 contract.
   */
  nodeTimings: Record<NodeSlot, number>
  taskId: string
  totalWallClockMs: number
  type: 'curate-flow:run'
}

export class MetricsCollector {
  private readonly fallbacks: string[] = []
  private firstStartMs?: number
  private lastEndMs?: number
  private readonly startTimes = new Map<NodeSlot, number>()
  private readonly taskId: string
  private readonly timings: Partial<Record<NodeSlot, number>> = {}

  constructor(taskId: string) {
    this.taskId = taskId
  }

  public emit(): CurateFlowRunEvent {
    const totalWallClockMs =
      this.firstStartMs === undefined || this.lastEndMs === undefined
        ? 0
        : this.lastEndMs - this.firstStartMs

    // Zero-fill ALL slots so downstream consumers can index by NodeSlot
    // unconditionally. Slots that did not run report 0.
    const nodeTimings = {} as Record<NodeSlot, number>
    for (const slot of NODE_SLOT_ORDER) {
      nodeTimings[slot] = this.timings[slot] ?? 0
    }

    return {
      fallbacksTriggered: [...this.fallbacks],
      nodeTimings,
      taskId: this.taskId,
      totalWallClockMs,
      type: 'curate-flow:run',
    }
  }

  public endNode(slot: NodeSlot): void {
    const start = this.startTimes.get(slot)
    if (start === undefined) {
      throw new Error(`MetricsCollector.endNode: no matching startNode for slot "${slot}"`)
    }

    const now = performance.now()
    this.timings[slot] = now - start
    this.lastEndMs = now
    this.startTimes.delete(slot)
  }

  public recordFallback(label: string): void {
    this.fallbacks.push(label)
  }

  public startNode(slot: NodeSlot): void {
    const now = performance.now()
    this.startTimes.set(slot, now)
    if (this.firstStartMs === undefined) {
      this.firstStartMs = now
    }
  }
}
