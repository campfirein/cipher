/**
 * Context compression strategies module
 */

// Compression strategies (alphabetical order)
export {createEnhancedCompactionStrategy, EnhancedCompactionStrategy} from './enhanced-compaction.js'
export type {CompactionResult, EnhancedCompactionOptions} from './enhanced-compaction.js'

// Filter utilities
export {
  filterCompacted,
  findSummaryMessage,
  getCompressionStats,
  getFilteredMessageCount,
  hasSummaryMessage,
  isSummaryMessage,
} from './filter-compacted.js'

// More compression strategies
export {MiddleRemovalStrategy} from './middle-removal.js'
export {OldestRemovalStrategy} from './oldest-removal.js'
export {createReactiveOverflowStrategy, ReactiveOverflowStrategy} from './reactive-overflow.js'
export type {ReactiveOverflowOptions} from './reactive-overflow.js'

// Types
export type {CompressionStrategyOptions, ICompressionStrategy} from './types.js'
