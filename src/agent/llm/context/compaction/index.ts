/**
 * Compaction module for managing context size in granular history storage.
 *
 * Exports:
 * - CompactionService: Main service for overflow detection and compaction
 * - createCompactionService: Factory function
 * - Types: CompactionConfig, OverflowCheckResult, CompactionInput
 */

export {
  type CompactionConfig,
  type CompactionInput,
  CompactionService,
  createCompactionService,
  type OverflowCheckResult,
} from './compaction-service.js'
