/**
 * Context compression strategies module
 */

// Compression helpers (shared across strategies)
export {
  countHistoryTokens,
  countMessageTokens,
  extractTextContent,
  findTurnBoundaries,
  formatMessagesForSummary,
  formatRole,
} from './compression-helpers.js'

// Compression quality evaluator (Pattern 4)
export {CompressionQualityEvaluator} from './compression-quality-evaluator.js'
export type {CompressionDimensions, CompressionQualityEvaluatorOptions, CompressionQualitySnapshot} from './compression-quality-evaluator.js'

// Compression strategies (alphabetical order)
export {createEnhancedCompactionStrategy, EnhancedCompactionStrategy} from './enhanced-compaction.js'
export type {CompactionResult, EnhancedCompactionOptions} from './enhanced-compaction.js'
export {EscalatedCompressionStrategy} from './escalated-compression.js'
export type {EscalatedCompressionOptions} from './escalated-compression.js'

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
