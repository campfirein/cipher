import type {ChannelAgentDriver} from './types.js'

/**
 * Per-(channel, agent) cache of long-lived driver instances. One driver = one
 * ACP session for the entire channel lifetime; reused across turns by the
 * orchestrator's `driverFor` callback.
 *
 * Lifecycle (Phase 2 plan §2.2 / §2.3, F6 review fix):
 *  - Pool owns `forceClose()` calls. The cancel coordinator only routes
 *    `requestCancel`/`forceClose` for an active turn.
 *  - `closeChannel(channelId)` closes every driver tagged with that channel
 *    (called when `ChannelMeta.status` flips to `archived`).
 *  - `closeAll()` is the daemon-shutdown handler.
 */
export class DriverPool {
  private readonly cache = new Map<string, ChannelAgentDriver>()

  public async closeAll(): Promise<void> {
    const drivers = [...this.cache.values()]
    this.cache.clear()
    await Promise.all(drivers.map((driver) => safeClose(driver)))
  }

  public async closeChannel(channelId: string): Promise<void> {
    const prefix = `${channelId}::`
    const tasks: Array<Promise<void>> = []
    for (const [key, driver] of this.cache) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key)
        tasks.push(safeClose(driver))
      }
    }

    await Promise.all(tasks)
  }

  /** Drop the (channelId, agentId) cache entry. Used by the cancel coordinator after `forceClose()`. */
  public evict(channelId: string, agentId: string): void {
    this.cache.delete(`${channelId}::${agentId}`)
  }

  /**
   * Returns the cached driver, or constructs one with the supplied factory and caches it.
   *
   * Codex F5 review fix: if a cached driver was hard-closed (e.g. by the cancel coordinator
   * escalating to `forceClose()`), evict it and recreate. Without this, the next turn for
   * the same `(channelId, agentId)` would borrow a permanently-closed driver and fail
   * with "AcpDriver is closed" until the channel was archived or the daemon restarted.
   */
  public getOrCreate(
    channelId: string,
    agentId: string,
    factory: () => ChannelAgentDriver,
  ): ChannelAgentDriver {
    const key = `${channelId}::${agentId}`
    const existing = this.cache.get(key)
    if (existing && !isDriverClosed(existing)) return existing

    if (existing) this.cache.delete(key)
    const driver = factory()
    this.cache.set(key, driver)
    return driver
  }
}

/**
 * Best-effort closed-state probe. Drivers that expose `isClosed()` (the in-tree `AcpDriver`
 * does) report definitively; drivers that don't (the `MockChannelAgentDriver` test stub)
 * are assumed to be live. The pool does not require all drivers to implement this method.
 */
function isDriverClosed(driver: ChannelAgentDriver): boolean {
  const probe = (driver as ChannelAgentDriver & {isClosed?(): boolean}).isClosed
  return typeof probe === 'function' && probe.call(driver)
}

async function safeClose(driver: ChannelAgentDriver): Promise<void> {
  try {
    await driver.forceClose()
  } catch {
    // Drivers are responsible for swallowing internal errors during teardown;
    // we still don't want one driver's failure to block the rest of the pool.
  }
}
