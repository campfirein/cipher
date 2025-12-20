import type {ILogger} from '../../core/interfaces/cipher/i-logger.js'
import type {IInstanceDiscovery} from '../../core/interfaces/instance/i-instance-discovery.js'
import type {ITransportClient} from '../../core/interfaces/transport/i-transport-client.js'

import {
  ConnectionFailedError,
  InstanceCrashedError,
  NoInstanceRunningError,
} from '../../core/domain/errors/connection-error.js'
import {NoOpLogger} from '../../core/interfaces/cipher/i-logger.js'
import {FileInstanceDiscovery} from '../instance/file-instance-discovery.js'
import {SocketIOTransportClient} from './socket-io-transport-client.js'

/**
 * Result of connection attempt.
 */
export type ConnectionResult = {
  /** The connected transport client */
  client: ITransportClient
  /** Project root where instance was found */
  projectRoot: string
}

/**
 * Configuration for TransportClientFactory.
 */
export type TransportClientFactoryConfig = {
  /** Instance discovery service */
  discovery?: IInstanceDiscovery
  /** Logger instance */
  logger?: ILogger
  /** Maximum retry attempts (default: 8 for sandbox environments) */
  maxRetries?: number
  /** Delay between retries in ms (default: 150 for faster sandbox warm-up) */
  retryDelayMs?: number
}

/**
 * Factory for creating connected transport clients.
 *
 * Handles:
 * - Instance discovery (walk-up directory tree)
 * - Connection establishment
 * - Retry logic
 * - Error translation to user-friendly messages
 */
export class TransportClientFactory {
  private readonly discovery: IInstanceDiscovery
  private readonly logger: ILogger
  private readonly maxRetries: number
  private readonly retryDelayMs: number

  constructor(config?: TransportClientFactoryConfig) {
    this.discovery = config?.discovery ?? new FileInstanceDiscovery()
    this.logger = config?.logger ?? new NoOpLogger()
    // Increased retries for sandbox warm-up scenarios (IDE terminals like Cursor)
    // First connection often fails, subsequent ones succeed after sandbox "warms up"
    this.maxRetries = config?.maxRetries ?? 8
    // Shorter delay to retry faster after sandbox warm-up
    this.retryDelayMs = config?.retryDelayMs ?? 150
  }

  /**
   * Discovers a running instance and connects to it.
   *
   * @param fromDir - Directory to start discovery from (default: cwd)
   * @returns Connected client and project root
   * @throws NoInstanceRunningError - No .brv directory found
   * @throws InstanceCrashedError - Instance found but process dead
   * @throws ConnectionFailedError - Instance found but connection failed
   */
  async connect(fromDir: string = process.cwd()): Promise<ConnectionResult> {
    // Discover running instance
    this.logger.debug('Discovering instance', {fromDir})
    const result = await this.discovery.discover(fromDir)

    if (!result.found) {
      if (result.reason === 'instance_crashed') {
        throw new InstanceCrashedError()
      }

      throw new NoInstanceRunningError()
    }

    const {instance, projectRoot} = result
    const url = instance.getTransportUrl()

    this.logger.info('Instance discovered', {pid: instance.pid, port: instance.port, projectRoot})

    // Connect with retry
    const client = await this.connectWithRetry(url, instance.port)

    return {client, projectRoot}
  }

  /**
   * Connects to the instance with retry logic.
   * Includes HTTP warm-up to trigger sandbox permission requests.
   *
   * Sandbox environments (like Cursor IDE terminals) block network access initially.
   * The first connection attempt triggers the permission request, subsequent attempts succeed.
   */
  private async connectWithRetry(url: string, port: number): Promise<ITransportClient> {
    let lastError: Error | undefined

    // HTTP warm-up: Try a simple HTTP request first to trigger sandbox permission
    // This is simpler than WebSocket and might trigger sandbox permission differently
    this.logger.debug('Attempting HTTP warm-up', {url})
    await this.httpWarmUp(url)
    // Small delay after HTTP warm-up
    await this.delay(100)

    // Now retry with proper connection attempts
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const client = new SocketIOTransportClient()

      try {
        this.logger.debug('Connection attempt', {attempt, maxRetries: this.maxRetries, url})
        // eslint-disable-next-line no-await-in-loop
        await client.connect(url)
        this.logger.info('Connected to instance', {clientId: client.getClientId(), url})
        return client
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        const errorMessage = lastError.message.toLowerCase()
        const isSandboxError =
          errorMessage.includes('websocket error') ||
          errorMessage.includes('network') ||
          errorMessage.includes('connection failed') ||
          errorMessage.includes('econnrefused')

        this.logger.warn('Connection attempt failed', {
          attempt,
          error: lastError.message,
          isSandboxError,
        })

        // Don't retry on the last attempt
        if (attempt < this.maxRetries) {
          // For sandbox errors, use longer delays to allow network permissions to be granted
          // First retry: 300ms (if sandbox), 150ms (otherwise)
          // Second retry: 600ms (if sandbox), 300ms (otherwise)
          const baseDelay = isSandboxError ? 300 : this.retryDelayMs
          const delayMs = baseDelay * attempt
          // eslint-disable-next-line no-await-in-loop
          await this.delay(delayMs)
        }
      }
    }

    throw new ConnectionFailedError(port, lastError)
  }

  /**
   * Delay helper.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms)
    })
  }

  /**
   * Attempts an HTTP warm-up request to trigger sandbox network permission.
   * This uses native fetch() which might be handled differently by sandboxes than WebSocket.
   */
  private async httpWarmUp(url: string): Promise<boolean> {
    try {
      // Try to hit the Socket.IO endpoint with a simple HTTP GET
      // This might trigger sandbox permission without the WebSocket complexity
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 1000)

      // eslint-disable-next-line n/no-unsupported-features/node-builtins -- fetch available in Node 18+
      await fetch(`${url}/socket.io/?EIO=4&transport=polling`, {
        method: 'GET',
        signal: controller.signal,
      }).catch(() => {
        // Ignore errors - we just want to trigger the network request
      })

      clearTimeout(timeoutId)
      return true
    } catch {
      // HTTP warm-up failed - not critical, continue with WebSocket
      return false
    }
  }
}

/**
 * Singleton factory instance for convenience.
 */
let factoryInstance: TransportClientFactory | undefined

/**
 * Gets or creates the singleton factory.
 */
export function getTransportClientFactory(config?: TransportClientFactoryConfig): TransportClientFactory {
  if (!factoryInstance) {
    factoryInstance = new TransportClientFactory(config)
  }

  return factoryInstance
}

/**
 * Creates a new factory instance.
 */
export function createTransportClientFactory(config?: TransportClientFactoryConfig): TransportClientFactory {
  return new TransportClientFactory(config)
}
