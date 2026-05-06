import {randomUUID} from 'node:crypto'

import type {IGlobalConfigStore} from '../../../core/interfaces/storage/i-global-config-store.js'
import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'

import {
  GlobalConfigEvents,
  type GlobalConfigGetResponse,
  type GlobalConfigSetAnalyticsRequest,
  type GlobalConfigSetAnalyticsResponse,
} from '../../../../shared/transport/events/global-config-events.js'
import {GlobalConfig} from '../../../core/domain/entities/global-config.js'

export interface GlobalConfigHandlerDeps {
  globalConfigStore: IGlobalConfigStore
  transport: ITransportServer
}

/**
 * Handles globalConfig:get and globalConfig:setAnalytics events.
 * Re-reads the file every call (no in-memory cache for transport responses)
 * so the daemon always reflects the latest on-disk state. If no config
 * exists yet, the GET path seeds a fresh one with a stable deviceId.
 * SET_ANALYTICS is idempotent: if the requested state matches current state,
 * the file is not rewritten.
 *
 * Maintains a SYNC in-process cache of the analytics flag for consumers
 * that need a synchronous getter (M2.5's AnalyticsClient.isEnabled). The
 * cache is populated at construction (eager initial read) and refreshed
 * after every successful SET_ANALYTICS write. Transport responses still
 * read fresh from disk — the cache is purely an in-process bridge for
 * sync consumers.
 */
export class GlobalConfigHandler {
  private cachedAnalytics: boolean | undefined
  private readonly globalConfigStore: IGlobalConfigStore
  private readonly transport: ITransportServer

  constructor(deps: GlobalConfigHandlerDeps) {
    this.globalConfigStore = deps.globalConfigStore
    this.transport = deps.transport
  }

  /**
   * Synchronous getter for the cached analytics flag. Used by daemon-side
   * consumers (M2.5's AnalyticsClient) that cannot await the async store.
   *
   * THROWS if called before `refreshCache()` has resolved (or before any
   * GET/SET handler has populated the cache). A silent default-false here
   * caused a real product-correctness bug during M2.5 development —
   * `daemon_start` would observe analytics=false even when the user had it
   * enabled on disk. Failing loud forces the lifecycle requirement to
   * surface during bootstrap rather than silently miscount.
   */
  getCachedAnalytics(): boolean {
    if (this.cachedAnalytics === undefined) {
      throw new Error(
        'GlobalConfigHandler.getCachedAnalytics() called before refreshCache() resolved. ' +
          'Daemon bootstrap must `await handler.refreshCache()` before constructing any consumer that reads the cache.',
      )
    }

    return this.cachedAnalytics
  }

  /**
   * Synchronously refreshes the cached analytics flag from disk. Daemon
   * bootstrap awaits this once before constructing AnalyticsClient so
   * the very first `track()` (e.g. `daemon_start`) sees the correct
   * enabled state. Subsequent updates happen automatically inside
   * SET_ANALYTICS without any caller involvement.
   */
  async refreshCache(): Promise<void> {
    try {
      const existing = await this.globalConfigStore.read()
      this.cachedAnalytics = existing?.analytics ?? false
    } catch {
      // Best-effort — leave cache at default false on read failure
    }
  }

  setup(): void {
    this.transport.onRequest<void, GlobalConfigGetResponse>(GlobalConfigEvents.GET, async () => this.read())
    this.transport.onRequest<GlobalConfigSetAnalyticsRequest, GlobalConfigSetAnalyticsResponse>(
      GlobalConfigEvents.SET_ANALYTICS,
      async (data) => this.setAnalytics(data.analytics),
    )
  }

  private async read(): Promise<GlobalConfigGetResponse> {
    const existing = await this.globalConfigStore.read()
    if (existing) {
      this.cachedAnalytics = existing.analytics
      return {
        analytics: existing.analytics,
        deviceId: existing.deviceId,
        version: existing.version,
      }
    }

    const seeded = GlobalConfig.create(randomUUID())
    await this.globalConfigStore.write(seeded)
    this.cachedAnalytics = seeded.analytics
    return {
      analytics: seeded.analytics,
      deviceId: seeded.deviceId,
      version: seeded.version,
    }
  }

  private async setAnalytics(analytics: boolean): Promise<GlobalConfigSetAnalyticsResponse> {
    const existing = await this.globalConfigStore.read()
    const previous = existing?.analytics ?? false

    // Idempotent fast path: short-circuit before generating a deviceId.
    // If existing is undefined and the requested value matches the default
    // (false), no file is created — the next GET will seed.
    if (previous === analytics) {
      this.cachedAnalytics = previous
      return {current: previous, previous}
    }

    const current = existing ?? GlobalConfig.create(randomUUID())
    const updated = current.withAnalytics(analytics)
    await this.globalConfigStore.write(updated)
    // Cache is in-process-authoritative — we trust the value just written.
    // Cross-process changes (another daemon writing the same file, manual
    // edits) are NOT observable until the next daemon restart. The
    // single-daemon model makes this safe today.
    this.cachedAnalytics = updated.analytics
    return {current: updated.analytics, previous}
  }
}
