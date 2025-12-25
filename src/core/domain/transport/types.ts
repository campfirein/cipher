/**
 * Transport Configuration Types
 *
 * These are configuration types for Socket.IO server/client setup.
 * For message schemas and payloads, see ./schemas.ts
 */

/**
 * Configuration for transport server.
 */
export type TransportServerConfig = {
  /**
   * CORS origin configuration.
   * @default '*' for localhost trust
   */
  corsOrigin?: string

  /**
   * Ping interval in milliseconds for heartbeat.
   * Lower = faster disconnect detection, higher network overhead.
   */
  pingIntervalMs?: number

  /**
   * Ping timeout in milliseconds.
   * If client doesn't respond within this time, considered disconnected.
   */
  pingTimeoutMs?: number
}

/**
 * Socket.IO transport types.
 * 'websocket' is preferred for sandboxed environments (like IDE terminals).
 * 'polling' uses HTTP long-polling which may be blocked by some sandboxes.
 */
export type SocketTransport = 'polling' | 'websocket'

/**
 * Configuration for transport client.
 */
export type TransportClientConfig = {
  /**
   * Connection timeout in milliseconds.
   */
  connectTimeoutMs?: number

  /**
   * Number of reconnection attempts before giving up.
   */
  reconnectionAttempts?: number

  /**
   * Maximum reconnection delay in milliseconds.
   */
  reconnectionDelayMaxMs?: number

  /**
   * Initial reconnection delay in milliseconds.
   */
  reconnectionDelayMs?: number

  /**
   * Default request timeout in milliseconds.
   */
  requestTimeoutMs?: number

  /**
   * Room operation timeout in milliseconds.
   */
  roomTimeoutMs?: number

  /**
   * Socket.IO transport types to use.
   * Defaults to ['websocket'] to avoid HTTP polling issues in sandboxed environments.
   * Set to ['polling', 'websocket'] for default Socket.IO behavior.
   */
  transports?: SocketTransport[]
}
