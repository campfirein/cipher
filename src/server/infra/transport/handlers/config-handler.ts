import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'

import {ConfigEvents, type ConfigGetEnvironmentResponse} from '../../../../shared/transport/events/config-events.js'
import {getCurrentConfig, isDevelopment} from '../../../config/environment.js'

export interface ConfigHandlerDeps {
  transport: ITransportServer
}

/**
 * Handles config:* events.
 * Pure data retrieval — no UI, no terminal.
 */
export class ConfigHandler {
  private readonly transport: ITransportServer

  constructor(deps: ConfigHandlerDeps) {
    this.transport = deps.transport
  }

  setup(): void {
    this.transport.onRequest<void, ConfigGetEnvironmentResponse>(ConfigEvents.GET_ENVIRONMENT, () => {
      const config = getCurrentConfig()
      return {
        apiBaseUrl: config.apiBaseUrl,
        isDevelopment: isDevelopment(),
        webAppUrl: config.webAppUrl,
      }
    })
  }
}
