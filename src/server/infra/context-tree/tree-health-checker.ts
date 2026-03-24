/**
 * Lightweight tree health checker — detects structural issues by scanning
 * the full context tree (not the lane-budgeted manifest subset).
 *
 * Designed to run after curation completes. Returns diagnostic signals
 * appended to the curation response. Does NOT execute any reorg operations.
 *
 * Cooldown: per-project, skips check if last check was within the interval.
 * Cooldown is only consumed AFTER eligibility checks pass.
 */

import {glob} from 'glob'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'

import {BRV_DIR, CONTEXT_FILE_EXTENSION, CONTEXT_TREE_DIR} from '../../constants.js'
import {parseFrontmatterScoring} from '../../core/domain/knowledge/markdown-writer.js'
import {DEMOTE_FROM_VALIDATED} from '../../core/domain/knowledge/memory-scoring.js'
import {isArchiveStub, isDerivedArtifact} from './derived-artifact.js'

// ── Thresholds ──────────────────────────────────────────────────────────────

/** Minimum entries in the tree before health checks run */
export const MIN_ENTRIES_FOR_CHECK = 10

/** Maximum entries per domain before flagging as oversized */
export const MAX_ENTRIES_PER_DOMAIN = 50

/** Low-importance ratio threshold (fraction of entries below DEMOTE_FROM_VALIDATED) */
export const LOW_IMPORTANCE_RATIO_THRESHOLD = 0.4

/** Minimum number of domains for imbalance detection */
export const MIN_DOMAINS_FOR_IMBALANCE = 2

/** Domain size ratio: largest / smallest > this → imbalanced */
export const DOMAIN_IMBALANCE_RATIO = 5

/** Default cooldown between checks (ms) — 10 minutes */
export const DEFAULT_CHECK_COOLDOWN_MS = 10 * 60 * 1000

// ── Types ───────────────────────────────────────────────────────────────────

export interface TreeHealthIssue {
  /** Domain path affected (or 'global' for tree-wide issues) */
  domain: string
  /** Human-readable description */
  message: string
  /** Numeric detail (e.g., entry count, ratio) */
  metric: number
  /** Issue severity */
  severity: 'info' | 'warning'
  /** Issue type for programmatic handling */
  type: 'domain_imbalance' | 'low_importance_ratio' | 'oversized_domain'
}

export interface TreeHealthReport {
  /** Total context entries in the tree */
  entryCount: number
  /** Issues detected (empty = healthy) */
  issues: TreeHealthIssue[]
  /** Timestamp of this check */
  timestamp: number
}

interface EntryInfo {
  domain: string
  importance: number
  path: string
}

// ── Cooldown state (per-project) ────────────────────────────────────────────

const cooldownByProject = new Map<string, number>()

/**
 * Reset all cooldowns (for testing).
 */
export function resetCooldown(): void {
  cooldownByProject.clear()
}

// ── Main check ──────────────────────────────────────────────────────────────

/**
 * Check tree health by scanning the full context tree.
 *
 * Reads all .md files (skipping derived artifacts) and extracts importance
 * from frontmatter. This gives an accurate count of ALL entries, not just
 * the lane-budgeted subset in the manifest.
 *
 * Returns null if cooldown hasn't elapsed for this project.
 * Cooldown is consumed only AFTER eligibility checks pass.
 *
 * @param baseDir - Project base directory
 * @param cooldownMs - Minimum interval between checks per project (default: 10 min)
 * @returns Health report, or null if skipped
 */
export async function checkTreeHealth(
  baseDir: string,
  cooldownMs = DEFAULT_CHECK_COOLDOWN_MS,
): Promise<null | TreeHealthReport> {
  const now = Date.now()
  const lastCheck = cooldownByProject.get(baseDir) ?? 0
  if (now - lastCheck < cooldownMs) return null

  const contextTreeDir = join(baseDir, BRV_DIR, CONTEXT_TREE_DIR)

  // Scan all .md files in the context tree
  const entries = await scanEntries(contextTreeDir)

  if (entries.length < MIN_ENTRIES_FOR_CHECK) {
    // Don't consume cooldown for small trees — next curate should check again
    return {entryCount: entries.length, issues: [], timestamp: now}
  }

  // Eligibility passed — consume cooldown
  cooldownByProject.set(baseDir, now)

  const issues: TreeHealthIssue[] = []
  const domainEntries = groupByDomain(entries)

  // Check 1: Oversized domains
  for (const [domain, domEntries] of domainEntries) {
    if (domEntries.length > MAX_ENTRIES_PER_DOMAIN) {
      issues.push({
        domain,
        message: `Domain "${domain}" has ${domEntries.length} entries (threshold: ${MAX_ENTRIES_PER_DOMAIN}). Consider merging duplicates or splitting into subdomains.`,
        metric: domEntries.length,
        severity: 'warning',
        type: 'oversized_domain',
      })
    }
  }

  // Check 2: Domain imbalance
  if (domainEntries.size >= MIN_DOMAINS_FOR_IMBALANCE) {
    const sizes = [...domainEntries.values()].map((e) => e.length)
    const largest = Math.max(...sizes)
    const smallest = Math.min(...sizes)

    if (smallest > 0 && largest / smallest > DOMAIN_IMBALANCE_RATIO) {
      const largestDomain = [...domainEntries.entries()].find(([, e]) => e.length === largest)?.[0] ?? 'unknown'
      issues.push({
        domain: largestDomain,
        message: `Domain imbalance detected: largest domain has ${largest} entries, smallest has ${smallest} (ratio: ${(largest / smallest).toFixed(1)}x). Some entries may be misclassified.`,
        metric: largest / smallest,
        severity: 'info',
        type: 'domain_imbalance',
      })
    }
  }

  // Check 3: Low-importance ratio
  const lowImportanceCount = entries.filter((e) => e.importance < DEMOTE_FROM_VALIDATED).length
  const lowImportanceRatio = lowImportanceCount / entries.length

  if (lowImportanceRatio > LOW_IMPORTANCE_RATIO_THRESHOLD) {
    issues.push({
      domain: 'global',
      message: `${(lowImportanceRatio * 100).toFixed(0)}% of entries have low importance (<${DEMOTE_FROM_VALIDATED}). Consider running \`brv reorg\` to merge or archive stale entries.`,
      metric: lowImportanceRatio,
      severity: 'warning',
      type: 'low_importance_ratio',
    })
  }

  return {entryCount: entries.length, issues, timestamp: now}
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function scanEntries(contextTreeDir: string): Promise<EntryInfo[]> {
  const pattern = `**/*${CONTEXT_FILE_EXTENSION}`
  const files = await glob(pattern, {cwd: contextTreeDir, posix: true})

  const entries: EntryInfo[] = []
  for (const relativePath of files) {
    if (isDerivedArtifact(relativePath) || isArchiveStub(relativePath)) continue

    const domain = relativePath.split('/')[0] ?? 'unknown'
    let importance = 50 // default

    try {
      // eslint-disable-next-line no-await-in-loop
      const content = await readFile(join(contextTreeDir, relativePath), 'utf8')
      const scoring = parseFrontmatterScoring(content)
      if (scoring?.importance !== undefined) {
        importance = scoring.importance
      }
    } catch {
      // Skip unreadable files
    }

    entries.push({domain, importance, path: relativePath})
  }

  return entries
}

function groupByDomain(entries: EntryInfo[]): Map<string, EntryInfo[]> {
  const map = new Map<string, EntryInfo[]>()
  for (const entry of entries) {
    const list = map.get(entry.domain) ?? []
    list.push(entry)
    map.set(entry.domain, list)
  }

  return map
}
