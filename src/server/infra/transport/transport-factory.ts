import type {TransportServerConfig} from '../../core/domain/transport/types.js'
import type {ITransportServer} from '../../core/interfaces/transport/i-transport-server.js'

import {TRANSPORT_PING_INTERVAL_MS, TRANSPORT_PING_TIMEOUT_MS} from '../../constants.js'
import {SocketIOTransportServer} from './socket-io-transport-server.js'

/**
 * Default server configuration using constants.
 */
const DEFAULT_SERVER_CONFIG: Required<TransportServerConfig> = {
  corsOrigin: '*',
  pingIntervalMs: TRANSPORT_PING_INTERVAL_MS,
  pingTimeoutMs: TRANSPORT_PING_TIMEOUT_MS,
}

/**
 * Creates a transport server instance.
 *
 * @param config - Optional server configuration, defaults to constants
 * @returns Transport server implementation
 *
 * @example
 * // Use defaults
 * const server = createTransportServer();
 *
 * @example
 * // Custom config
 * const server = createTransportServer({ pingIntervalMs: 2000 });
 */
export function createTransportServer(config?: TransportServerConfig): ITransportServer {
  const mergedConfig = {...DEFAULT_SERVER_CONFIG, ...config}
  return new SocketIOTransportServer(mergedConfig)
}

// NOTE: For transport client, use connectToTransport() from @campfirein/brv-transport-client
// Do NOT use new TransportClient() directly - it requires manual discovery and connection
// Example: const {client, projectRoot} = await connectToTransport()
