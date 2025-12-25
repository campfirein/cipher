// TODO(v0.5.0): Remove this entire module. Replaced by CoreProcess + TaskProcessor + Transport events.

/**
 * Consumer Module - Public API for queue processing and UI monitoring
 *
 * Architecture (legacy):
 * - ConsumerService: Singleton background worker (start once in main)
 * - QueuePollingService: UI subscribes here for real-time updates
 * - Both communicate via AgentStorage (SQLite DB)
 *
 * Usage:
 * ```typescript
 * // Main process - start consumer singleton
 * import { getConsumerService } from 'byterover-cli/dist/infra/cipher/consumer'
 * const consumer = getConsumerService({ concurrency: 5 })
 * await consumer.start()
 *
 * // UI components - subscribe to polling service
 * import { getQueuePollingService } from 'byterover-cli/dist/infra/cipher/consumer'
 * const poller = getQueuePollingService({ pollInterval: 500 })
 * poller.on('snapshot', (snapshot) => renderUI(snapshot))
 * poller.on('execution:completed', (exec) => showNotification(exec))
 * await poller.start()
 *
 * // Cleanup
 * consumer.dispose()
 * poller.stop()
 * ```
 */

// ==================== LOW-LEVEL API (for advanced usage) ====================
export {isConsumerRunning, isConsumerRunningSync} from './consumer-lock.js'
// ==================== HIGH-LEVEL API (for UI/REPL) ====================
export {ConsumerService, disposeConsumerService, getConsumerService} from './consumer-service.js'

export type {ConsumerServiceOptions} from './consumer-service.js'
export {
  createExecutionConsumer,
  ExecutionConsumer,
  getConsumer,
  stopConsumer,
  tryStartConsumer,
} from './execution-consumer.js'
export {getQueuePollingService, QueuePollingService, stopQueuePollingService} from './queue-polling-service.js'
export type {ExecutionWithToolCalls, QueueSnapshot, QueueStats} from './queue-polling-service.js'
