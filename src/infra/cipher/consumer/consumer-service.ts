import {EventEmitter} from 'node:events'

import type {Execution} from '../storage/agent-storage.js'

import {ProjectConfigStore} from '../../config/file-config-store.js'
import {KeychainTokenStore} from '../../storage/keychain-token-store.js'
import {closeAgentStorage} from '../storage/agent-storage.js'
import {createExecutionConsumer, ExecutionConsumer} from './execution-consumer.js'

// ==================== TYPES ====================

export interface ConsumerServiceEvents {
  error: (error: Error) => void
  'job:completed': (execution: Execution) => void
  'job:failed': (execution: Execution, error: string) => void
  'job:started': (execution: Execution) => void
  started: () => void
  stopped: () => void
}

export interface ConsumerServiceOptions {
  /** Max concurrent jobs (default: 5) */
  concurrency?: number
  /** Poll interval in ms (default: 1000) */
  pollInterval?: number
}

// ==================== SERVICE ====================

/**
 * ConsumerService - High-level API for UI/REPL integration
 *
 * Simple usage:
 * ```typescript
 * import { ConsumerService } from 'byterover-cli/consumer'
 *
 * const consumer = new ConsumerService()
 * await consumer.start()   // Auto-loads auth & config
 * // ... consumer is running ...
 * consumer.dispose()       // Cleanup
 * ```
 *
 * Features:
 * - Auto-loads auth token from Keychain
 * - Auto-loads project config from .brv/config.json
 * - Handles lock acquisition/release
 * - Emits events for job lifecycle
 * - Single dispose() for full cleanup
 */
// eslint-disable-next-line unicorn/prefer-event-target -- EventEmitter better for Node.js typed events
export class ConsumerService extends EventEmitter {
  private consumer: ExecutionConsumer | null = null
  private readonly options: ConsumerServiceOptions
  private running = false

  constructor(options?: ConsumerServiceOptions) {
    super()
    this.options = options ?? {}
  }

  /**
   * Stop the consumer and cleanup all resources
   */
  dispose(): void {
    if (!this.running) return

    this.running = false

    if (this.consumer) {
      this.consumer.stop()
      this.consumer = null
    }

    closeAgentStorage()

    this.emit('stopped')
  }

  /**
   * Check if consumer is running
   */
  isRunning(): boolean {
    return this.running && this.consumer !== null
  }

  /**
   * Start the consumer
   *
   * - Loads auth token from Keychain
   * - Loads project config from .brv/config.json
   * - Acquires consumer lock
   * - Starts processing queue
   *
   * @throws Error if not authenticated
   * @throws Error if another consumer is already running
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('Consumer already running')
    }

    // Load auth token
    const tokenStore = new KeychainTokenStore()
    const token = await tokenStore.load()
    if (!token) {
      throw new Error('Not authenticated. Please run "brv login" first.')
    }

    // Load project config (optional)
    const configStore = new ProjectConfigStore()
    const brvConfig = await configStore.read()

    // Create consumer (auto-detects .brv/blobs from cwd)
    this.consumer = createExecutionConsumer({
      authToken: {accessToken: token.accessToken, sessionKey: token.sessionKey},
      brvConfig: brvConfig ?? undefined,
      maxConcurrency: this.options.concurrency ?? 5,
      pollInterval: this.options.pollInterval ?? 1000,
    })

    // Start consumer
    const started = await this.consumer.start()
    if (!started) {
      this.consumer = null
      throw new Error('Another consumer is already running in this directory')
    }

    this.running = true
    this.setupSignalHandlers()
    this.emit('started')
  }

  // Alias for dispose
  stop(): void {
    this.dispose()
  }

  // ==================== PRIVATE ====================

  private setupSignalHandlers(): void {
    // eslint-disable-next-line unicorn/consistent-function-scoping -- needs 'this' context
    const cleanup = (): void => {
      this.dispose()
    }

    process.on('SIGTERM', cleanup)
    process.on('SIGINT', cleanup)
    process.on('exit', cleanup)
  }
}

// ==================== SINGLETON HELPER ====================

let instance: ConsumerService | null = null

/**
 * Get or create singleton ConsumerService
 *
 * Usage:
 * ```typescript
 * const consumer = getConsumerService()
 * await consumer.start()
 * // later...
 * consumer.dispose()
 * ```
 */
export function getConsumerService(options?: ConsumerServiceOptions): ConsumerService {
  if (!instance) {
    instance = new ConsumerService(options)
  }

  return instance
}

/**
 * Dispose singleton and clear reference
 */
export function disposeConsumerService(): void {
  if (instance) {
    instance.dispose()
    instance = null
  }
}
