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
  /** Maximum retry attempts (default: 3) */
  maxRetries?: number
  /** Delay between retries in ms (default: 1000) */
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
    this.maxRetries = config?.maxRetries ?? 3
    this.retryDelayMs = config?.retryDelayMs ?? 1000
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
   */
  private async connectWithRetry(url: string, port: number): Promise<ITransportClient> {
    let lastError: Error | undefined

    // Retry loop needs sequential awaits - can't parallelize connection attempts
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
        this.logger.warn('Connection attempt failed', {attempt, error: lastError.message})

        // Don't retry on the last attempt
        if (attempt < this.maxRetries) {
          // eslint-disable-next-line no-await-in-loop
          await this.delay(this.retryDelayMs * attempt) // Exponential backoff
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
