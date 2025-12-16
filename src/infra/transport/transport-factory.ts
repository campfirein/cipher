import type {TransportClientConfig, TransportServerConfig} from '../../core/domain/transport/types.js'
import type {ITransportClient} from '../../core/interfaces/transport/i-transport-client.js'
import type {ITransportServer} from '../../core/interfaces/transport/i-transport-server.js'

import {
  TRANSPORT_CONNECT_TIMEOUT_MS,
  TRANSPORT_PING_INTERVAL_MS,
  TRANSPORT_PING_TIMEOUT_MS,
  TRANSPORT_RECONNECTION_ATTEMPTS,
  TRANSPORT_RECONNECTION_DELAY_MAX_MS,
  TRANSPORT_RECONNECTION_DELAY_MS,
  TRANSPORT_REQUEST_TIMEOUT_MS,
  TRANSPORT_ROOM_TIMEOUT_MS,
} from '../../constants.js'
import {SocketIOTransportClient} from './socket-io-transport-client.js'
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
 * Default client configuration using constants.
 */
const DEFAULT_CLIENT_CONFIG: Required<TransportClientConfig> = {
  connectTimeoutMs: TRANSPORT_CONNECT_TIMEOUT_MS,
  reconnectionAttempts: TRANSPORT_RECONNECTION_ATTEMPTS,
  reconnectionDelayMaxMs: TRANSPORT_RECONNECTION_DELAY_MAX_MS,
  reconnectionDelayMs: TRANSPORT_RECONNECTION_DELAY_MS,
  requestTimeoutMs: TRANSPORT_REQUEST_TIMEOUT_MS,
  roomTimeoutMs: TRANSPORT_ROOM_TIMEOUT_MS,
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

/**
 * Creates a transport client instance.
 *
 * @param config - Optional client configuration, defaults to constants
 * @returns Transport client implementation
 *
 * @example
 * // Use defaults
 * const client = createTransportClient();
 *
 * @example
 * // Custom config for tests
 * const client = createTransportClient({ connectTimeoutMs: 1000 });
 */
export function createTransportClient(config?: TransportClientConfig): ITransportClient {
  const mergedConfig = {...DEFAULT_CLIENT_CONFIG, ...config}
  return new SocketIOTransportClient(mergedConfig)
}
