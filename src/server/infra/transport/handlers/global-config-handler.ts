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
 * Re-reads the file every call (no in-memory cache) so the daemon always
 * reflects the latest on-disk state, including writes from sibling commands.
 * If no config exists yet, seeds a fresh one with a stable deviceId.
 * SET_ANALYTICS is idempotent: if the requested state matches current state,
 * the file is not rewritten.
 */
export class GlobalConfigHandler {
  private readonly globalConfigStore: IGlobalConfigStore
  private readonly transport: ITransportServer

  constructor(deps: GlobalConfigHandlerDeps) {
    this.globalConfigStore = deps.globalConfigStore
    this.transport = deps.transport
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
      return {
        analytics: existing.analytics,
        deviceId: existing.deviceId,
        version: existing.version,
      }
    }

    const seeded = GlobalConfig.create(randomUUID())
    await this.globalConfigStore.write(seeded)
    return {
      analytics: seeded.analytics,
      deviceId: seeded.deviceId,
      version: seeded.version,
    }
  }

  private async setAnalytics(analytics: boolean): Promise<GlobalConfigSetAnalyticsResponse> {
    const existing = await this.globalConfigStore.read()
    const current = existing ?? GlobalConfig.create(randomUUID())
    const previous = current.analytics

    if (previous === analytics) {
      return {current: previous, previous}
    }

    const updated = GlobalConfig.fromJson({...current.toJson(), analytics})
    if (!updated) {
      throw new Error('Failed to construct updated GlobalConfig')
    }

    await this.globalConfigStore.write(updated)
    return {current: updated.analytics, previous}
  }
}
