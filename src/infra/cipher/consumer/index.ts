/**
 * Consumer Module - Public API for UI/REPL integration
 *
 * Simple usage:
 * ```typescript
 * import { ConsumerService } from 'byterover-cli/dist/infra/cipher/consumer'
 *
 * const consumer = new ConsumerService()
 * await consumer.start()   // Auto-loads auth & config
 * consumer.dispose()       // Cleanup
 * ```
 */

// ==================== LOW-LEVEL API (for advanced usage) ====================
export {isConsumerRunning, isConsumerRunningSync} from './consumer-lock.js'
// ==================== HIGH-LEVEL API (for UI/REPL) ====================
export {ConsumerService, disposeConsumerService, getConsumerService} from './consumer-service.js'

export type {ConsumerServiceEvents, ConsumerServiceOptions} from './consumer-service.js'
export {
  createExecutionConsumer,
  ExecutionConsumer,
  getConsumer,
  stopConsumer,
  tryStartConsumer,
} from './execution-consumer.js'
export {getQueuePollingService, QueuePollingService, stopQueuePollingService} from './queue-polling-service.js'
export type {ExecutionWithToolCalls, QueueSnapshot, QueueStats} from './queue-polling-service.js'
