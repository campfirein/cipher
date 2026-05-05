import {randomUUID} from 'node:crypto'

import type {IGlobalConfigStore} from '../../../core/interfaces/storage/i-global-config-store.js'
import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'

import {
  GlobalConfigEvents,
  type GlobalConfigGetResponse,
} from '../../../../shared/transport/events/global-config-events.js'
import {GlobalConfig} from '../../../core/domain/entities/global-config.js'

export interface GlobalConfigHandlerDeps {
  globalConfigStore: IGlobalConfigStore
  transport: ITransportServer
}

/**
 * Handles globalConfig:get event.
 * Re-reads the file every call (no in-memory cache) so the daemon always
 * reflects the latest on-disk state, including writes from sibling commands.
 * If no config exists yet, seeds a fresh one with a stable deviceId.
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
}
