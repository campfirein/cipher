/**
 * Context compression strategies module
 */

// Filter utilities
export {
  filterCompacted,
  findSummaryMessage,
  getCompressionStats,
  getFilteredMessageCount,
  hasSummaryMessage,
  isSummaryMessage,
} from './filter-compacted.js'

// Compression strategies
export {MiddleRemovalStrategy} from './middle-removal.js'
export {OldestRemovalStrategy} from './oldest-removal.js'
export {createReactiveOverflowStrategy, ReactiveOverflowStrategy} from './reactive-overflow.js'
export type {ReactiveOverflowOptions} from './reactive-overflow.js'

// Types
export type {CompressionStrategyOptions, ICompressionStrategy} from './types.js'
