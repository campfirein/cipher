import type {DriverPool} from './driver-pool.js'
import type {ChannelAgentDriver} from './types.js'

interface CancelCoordinatorOptions {
  /** Optional pool reference. When set, cancel-induced `forceClose()` evicts the driver so the next turn gets a fresh one (Codex F5). */
  driverPool?: DriverPool
  /** Time in ms to wait between soft `requestCancel()` and hard `forceClose()` escalation. Default 2000. */
  softCancelGraceMs?: number
}

interface Binding {
  agentId?: string
  driver: ChannelAgentDriver
}

const DEFAULT_GRACE_MS = 2000

/**
 * Passive index from `(channelId, turnId)` → active driver. The transport
 * `CANCEL` handler calls `cancelByTurnId(...)` which:
 *   1. Looks up the driver and calls its `requestCancel()` (one direct call).
 *   2. Waits `softCancelGraceMs` for the turn to settle (the orchestrator
 *      unbinds when the iterator completes — see the `try/finally` around
 *      the `for await` loop).
 *   3. If still bound, escalates to `forceClose()` to kill the subprocess.
 *      With a pool reference, evicts the driver so the next turn gets a fresh one.
 *
 * One direction of control (Phase 2 review F2): coordinator → driver. The
 * driver does **not** call back into the coordinator.
 *
 * Codex F4 review fix: `cancelByTurnId` returns `{cancelled}` so callers can
 * surface a truthful status instead of always claiming success.
 */
export class CancelCoordinator {
  private readonly bindings = new Map<string, Binding>()
  private readonly graceMs: number
  private readonly pool?: DriverPool

  public constructor(options: CancelCoordinatorOptions = {}) {
    this.graceMs = options.softCancelGraceMs ?? DEFAULT_GRACE_MS
    if (options.driverPool) this.pool = options.driverPool
  }

  public bind(channelId: string, turnId: string, driver: ChannelAgentDriver, agentId?: string): void {
    this.bindings.set(this.key(channelId, turnId), agentId === undefined ? {driver} : {agentId, driver})
  }

  public async cancelByTurnId(channelId: string, turnId: string): Promise<{cancelled: boolean}> {
    const key = this.key(channelId, turnId)
    const binding = this.bindings.get(key)
    if (!binding) return {cancelled: false}

    try {
      await binding.driver.requestCancel()
    } catch {
      // Soft cancel failures are non-fatal; we'll escalate.
    }

    await waitMs(this.graceMs)

    // If the orchestrator's `finally` already unbound, the soft cancel succeeded.
    if (!this.bindings.has(key)) return {cancelled: true}

    this.bindings.delete(key)
    try {
      await binding.driver.forceClose()
    } catch {
      // Best-effort teardown; the pool will GC the driver entry on next channel close.
    }

    if (this.pool && binding.agentId) this.pool.evict(channelId, binding.agentId)
    return {cancelled: true}
  }

  public size(): number {
    return this.bindings.size
  }

  public unbind(channelId: string, turnId: string): void {
    this.bindings.delete(this.key(channelId, turnId))
  }

  private key(channelId: string, turnId: string): string {
    return `${channelId}::${turnId}`
  }
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
