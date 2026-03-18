// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Quality dimensions for consolidation output.
 * All scores are 0-1, where 1 is best quality.
 */
export interface QualityDimensions {
  /** Fraction of bullets that start with an action verb. */
  actionability: number

  /** Fraction of original vocabulary covered by consolidated bullets. */
  coverageRecall: number

  /** 1 minus avg pairwise trigram similarity among consolidated bullets (less duplication = higher). */
  deduplicationQuality: number
}

/**
 * Result of evaluating consolidation quality.
 */
export interface QualityEvaluationResult {
  /** Per-dimension scores. */
  dimensions: QualityDimensions

  /** Weighted overall score: 0.35*dedup + 0.40*coverage + 0.25*actionability. */
  overallScore: number
}

export interface ConsolidationQualityEvaluatorOptions {
  /** Minimum improvement between rounds to continue (default: 0.05). */
  epsilon?: number

  /** Maximum consolidation rounds (default: 3). */
  maxRounds?: number

  /** Overall quality threshold to stop early (default: 0.75). */
  qualityThreshold?: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_ROUNDS = 3
const DEFAULT_EPSILON = 0.05
const DEFAULT_QUALITY_THRESHOLD = 0.75

const WEIGHT_DEDUP = 0.35
const WEIGHT_COVERAGE = 0.4
const WEIGHT_ACTIONABILITY = 0.25

/** Action verbs commonly found at the start of actionable bullets. */
const ACTION_VERB_PATTERN = /^(add|always|avoid|call|check|create|disable|do not|enable|ensure|never|prefer|remove|run|set|use)\b/i

/** Common English stopwords to exclude from vocabulary analysis. */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by',
  'can', 'do', 'for', 'from', 'had', 'has', 'have', 'he', 'her',
  'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its',
  'may', 'my', 'no', 'not', 'of', 'on', 'or', 'our', 'out',
  'she', 'so', 'than', 'that', 'the', 'their', 'them', 'then',
  'there', 'these', 'they', 'this', 'to', 'up', 'us', 'was',
  'we', 'what', 'when', 'which', 'who', 'will', 'with', 'you',
])

// ---------------------------------------------------------------------------
// ConsolidationQualityEvaluator
// ---------------------------------------------------------------------------

/**
 * Heuristic-based quality evaluator for consolidated knowledge bullets.
 *
 * Uses string analysis (not LLM calls) to keep cost at zero.
 * Designed to drive multi-round consolidation loops.
 */
export class ConsolidationQualityEvaluator {
  public readonly maxRounds: number
  private readonly epsilon: number
  private readonly qualityThreshold: number

  constructor(options?: ConsolidationQualityEvaluatorOptions) {
    this.maxRounds = options?.maxRounds ?? DEFAULT_MAX_ROUNDS
    this.epsilon = options?.epsilon ?? DEFAULT_EPSILON
    this.qualityThreshold = options?.qualityThreshold ?? DEFAULT_QUALITY_THRESHOLD
  }

  /**
   * Evaluate quality of consolidated bullets against the original set.
   */
  public evaluate(originalBullets: string[], consolidatedBullets: string[]): QualityEvaluationResult {
    const deduplicationQuality = this.scoreDeduplication(consolidatedBullets)
    const coverageRecall = this.scoreCoverage(originalBullets, consolidatedBullets)
    const actionability = this.scoreActionability(consolidatedBullets)

    const overallScore =
      (WEIGHT_DEDUP * deduplicationQuality) +
      (WEIGHT_COVERAGE * coverageRecall) +
      (WEIGHT_ACTIONABILITY * actionability)

    return {
      dimensions: {actionability, coverageRecall, deduplicationQuality},
      overallScore,
    }
  }

  /**
   * Check if the improvement loop should terminate.
   */
  public shouldTerminate(
    currentScore: number,
    previousScore: number | undefined,
    roundNumber: number,
  ): boolean {
    // Quality threshold met
    if (currentScore >= this.qualityThreshold) {
      return true
    }

    // Max rounds reached
    if (roundNumber >= this.maxRounds) {
      return true
    }

    // Plateau detection
    if (previousScore !== undefined && (currentScore - previousScore) < this.epsilon) {
      return true
    }

    return false
  }

  // ---------------------------------------------------------------------------
  // Private scoring methods
  // ---------------------------------------------------------------------------

  /** Build character trigrams from a string. */
  private buildTrigrams(text: string): Set<string> {
    const trigrams = new Set<string>()
    for (let i = 0; i <= text.length - 3; i++) {
      trigrams.add(text.slice(i, i + 3))
    }

    return trigrams
  }

  /** Build a vocabulary set from bullets (lowercase, stopwords removed). */
  private buildVocabulary(bullets: string[]): Set<string> {
    const vocab = new Set<string>()
    for (const bullet of bullets) {
      const words = bullet.toLowerCase().split(/\W+/)
      for (const word of words) {
        if (word.length > 1 && !STOPWORDS.has(word)) {
          vocab.add(word)
        }
      }
    }

    return vocab
  }

  /** Compute Jaccard similarity between two sets. */
  private jaccardSimilarity(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 && b.size === 0) {
      return 0
    }

    let intersection = 0
    for (const item of a) {
      if (b.has(item)) {
        intersection++
      }
    }

    const union = a.size + b.size - intersection

    return union > 0 ? intersection / union : 0
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Score actionability: fraction of bullets starting with action verbs.
   */
  private scoreActionability(bullets: string[]): number {
    if (bullets.length === 0) {
      return 1
    }

    let actionable = 0
    for (const bullet of bullets) {
      if (ACTION_VERB_PATTERN.test(bullet.trim())) {
        actionable++
      }
    }

    return actionable / bullets.length
  }

  /**
   * Score coverage recall: what fraction of original vocabulary is preserved.
   */
  private scoreCoverage(originalBullets: string[], consolidatedBullets: string[]): number {
    const originalVocab = this.buildVocabulary(originalBullets)
    if (originalVocab.size === 0) {
      return 1
    }

    const consolidatedVocab = this.buildVocabulary(consolidatedBullets)

    let overlap = 0
    for (const word of originalVocab) {
      if (consolidatedVocab.has(word)) {
        overlap++
      }
    }

    return overlap / originalVocab.size
  }

  /**
   * Score deduplication quality via character trigram Jaccard pairwise similarity.
   * Lower internal similarity = better dedup = higher score.
   */
  private scoreDeduplication(bullets: string[]): number {
    if (bullets.length < 2) {
      return 1
    }

    const trigramSets = bullets.map((b) => this.buildTrigrams(b.toLowerCase()))
    let totalSimilarity = 0
    let pairCount = 0

    for (let i = 0; i < trigramSets.length; i++) {
      for (let j = i + 1; j < trigramSets.length; j++) {
        totalSimilarity += this.jaccardSimilarity(trigramSets[i], trigramSets[j])
        pairCount++
      }
    }

    const avgSimilarity = pairCount > 0 ? totalSimilarity / pairCount : 0

    return Math.max(0, Math.min(1, 1 - avgSimilarity))
  }
}
