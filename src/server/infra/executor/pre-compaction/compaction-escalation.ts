/**
 * Re-export from shared utilities.
 * Original implementation moved to src/shared/utils/escalation-utils.ts
 * to allow cross-layer reuse (both server/ and agent/ can import).
 */
export {
  buildDeterministicFallbackCompaction,
  type CompactionEscalationTier,
  estimateTokens,
  isCompactionOutputValid,
  shouldAcceptCompactionOutput,
  withAggressiveCompactionDirective,
} from '../../../../shared/utils/escalation-utils.js'
