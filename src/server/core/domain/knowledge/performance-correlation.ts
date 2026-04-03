/**
 * Pure functions for computing performance-memory correlation factors.
 *
 * Uses insightsActive data from the performance log to determine which
 * knowledge entries correlate with high-performing curations.
 *
 * Factors are bounded to [-0.15, +0.15] via tanh saturation to prevent
 * runaway reinforcement. BM25 relevance (60% weight) still dominates.
 */

import type {NormalizedPerformanceLogEntry} from '../experience/experience-types.js'

/**
 * Minimum number of log entries with non-empty insightsActive before factors activate.
 * Below this count the per-domain average is too noisy to produce meaningful deltas.
 */
const MIN_ENTRIES_FOR_ACTIVATION = 5

/** Maximum magnitude of the performance factor (±15% importance multiplier) */
const MAX_FACTOR_MAGNITUDE = 0.15

/** Steepness multiplier for tanh saturation */
const TANH_STEEPNESS = 3

/**
 * Compute per-entry performance factors from correlation data.
 *
 * For each entry path that appears in insightsActive of performance log entries,
 * accumulates (score - domainAvg) and normalizes via tanh.
 *
 * @returns Map<canonicalPath, factor> where factor ∈ [-0.15, +0.15].
 *          Empty map when fewer than MIN_ENTRIES_FOR_ACTIVATION entries have data.
 */
export function computePerformanceFactors(log: NormalizedPerformanceLogEntry[]): Map<string, number> {
  const prepared = prepareCorrelationInputs(log)
  if (!prepared) {
    return new Map()
  }

  const {domainAvg, withInsights} = prepared

  // Accumulate deltas per entry path
  const pathDeltas = new Map<string, {count: number; sum: number}>()
  for (const entry of withInsights) {
    const avg = domainAvg.get(entry.domain) ?? 0.5
    const delta = entry.score - avg

    for (const path of entry.insightsActive) {
      const existing = pathDeltas.get(path) ?? {count: 0, sum: 0}
      existing.count++
      existing.sum += delta
      pathDeltas.set(path, existing)
    }
  }

  // Normalize via tanh
  const factors = new Map<string, number>()
  for (const [path, {count, sum}] of pathDeltas) {
    const normalized = Math.tanh((sum / count) * TANH_STEEPNESS) * MAX_FACTOR_MAGNITUDE
    factors.set(path, normalized)
  }

  return factors
}

/**
 * Compute domain-level performance factors as a fallback when path-level data is sparse.
 *
 * Domain key is extracted from the first path segment of insightsActive entries,
 * not from the task-level entry.domain field.
 *
 * @returns Map<domain, factor> where factor ∈ [-0.15, +0.15].
 */
export function computeDomainFactors(log: NormalizedPerformanceLogEntry[]): Map<string, number> {
  const prepared = prepareCorrelationInputs(log)
  if (!prepared) {
    return new Map()
  }

  const {domainAvg, withInsights} = prepared

  // Accumulate deltas per domain (from path segments)
  const domainDeltas = new Map<string, {count: number; sum: number}>()
  for (const entry of withInsights) {
    const avg = domainAvg.get(entry.domain) ?? 0.5
    const delta = entry.score - avg

    // Extract unique domains from insightsActive paths
    const domains = new Set(entry.insightsActive.map((p) => extractDomain(p)))
    for (const domain of domains) {
      const existing = domainDeltas.get(domain) ?? {count: 0, sum: 0}
      existing.count++
      existing.sum += delta
      domainDeltas.set(domain, existing)
    }
  }

  const factors = new Map<string, number>()
  for (const [domain, {count, sum}] of domainDeltas) {
    // This "domain" is the first path segment from insightsActive, not entry.domain.
    const normalized = Math.tanh((sum / count) * TANH_STEEPNESS) * MAX_FACTOR_MAGNITUDE
    factors.set(domain, normalized)
  }

  return factors
}

function prepareCorrelationInputs(
  log: NormalizedPerformanceLogEntry[],
): undefined | {domainAvg: Map<string, number>; withInsights: NormalizedPerformanceLogEntry[]} {
  const withInsights = log.filter((e) => e.insightsActive.length > 0)
  if (withInsights.length < MIN_ENTRIES_FOR_ACTIVATION) {
    return undefined
  }

  return {
    domainAvg: buildDomainAverages(log),
    withInsights,
  }
}

function buildDomainAverages(entries: NormalizedPerformanceLogEntry[]): Map<string, number> {
  const domainScores = new Map<string, number[]>()
  for (const entry of entries) {
    const scores = domainScores.get(entry.domain) ?? []
    scores.push(entry.score)
    domainScores.set(entry.domain, scores)
  }

  const domainAvg = new Map<string, number>()
  for (const [domain, scores] of domainScores) {
    domainAvg.set(domain, scores.reduce((a, b) => a + b, 0) / scores.length)
  }

  return domainAvg
}

/**
 * Extract the domain (first path segment) from a context-tree-relative path.
 * e.g., "experience/lessons/2026-03-30--foo.md" → "experience"
 * e.g., "auth/jwt_tokens/refresh.md" → "auth"
 */
export function extractDomain(path: string): string {
  const firstSlash = path.indexOf('/')
  return firstSlash === -1 ? path : path.slice(0, firstSlash)
}

/**
 * Look up the performance factor for a parent path, cascading through
 * _index.md and context.md variants before falling back to domain level.
 */
export function lookupParentFactor(
  parentPath: string,
  perfFactorMap: Map<string, number>,
  domainFactorMap: Map<string, number>,
): number {
  return perfFactorMap.get(parentPath)
    ?? perfFactorMap.get(`${parentPath}/_index.md`)
    ?? perfFactorMap.get(`${parentPath}/context.md`)
    ?? domainFactorMap.get(extractDomain(parentPath))
    ?? 0
}
