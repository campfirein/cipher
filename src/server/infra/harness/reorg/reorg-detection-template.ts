/* eslint-disable no-await-in-loop */
/**
 * Reorg candidate detection — walks context tree files and detects
 * merge and move candidates based on frontmatter keyword overlap
 * and importance thresholds.
 */

import {glob} from 'glob'
import {load as yamlLoad} from 'js-yaml'
import {readFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'

import type {ReorgCandidate} from '../../../core/interfaces/executor/i-reorg-executor.js'

import {parseFrontmatter, parseFrontmatterScoring} from '../../../core/domain/knowledge/markdown-writer.js'
import {DEMOTE_FROM_VALIDATED} from '../../../core/domain/knowledge/memory-scoring.js'
import {isDerivedArtifact} from '../../context-tree/derived-artifact.js'

// ── Default thresholds ──────────────────────────────────────────────────────

interface ReorgThresholds {
  mergeDetection: {
    keywordOverlapThreshold: number
    minImportanceForKeep: number
  }
  moveDetection: {
    crossDomainKeywordMatchThreshold: number
  }
}

const DEFAULT_THRESHOLDS: ReorgThresholds = {
  mergeDetection: {
    keywordOverlapThreshold: 0.7,
    minImportanceForKeep: DEMOTE_FROM_VALIDATED,
  },
  moveDetection: {
    crossDomainKeywordMatchThreshold: 0.6,
  },
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseThresholds(templateContent: string): ReorgThresholds {
  if (!templateContent.trim()) {
    return DEFAULT_THRESHOLDS
  }

  try {
    const parsed = yamlLoad(templateContent) as null | Partial<ReorgThresholds>
    if (!parsed || typeof parsed !== 'object') {
      return DEFAULT_THRESHOLDS
    }

    return {
      mergeDetection: {
        keywordOverlapThreshold:
          typeof parsed.mergeDetection?.keywordOverlapThreshold === 'number'
            ? parsed.mergeDetection.keywordOverlapThreshold
            : DEFAULT_THRESHOLDS.mergeDetection.keywordOverlapThreshold,
        minImportanceForKeep:
          typeof parsed.mergeDetection?.minImportanceForKeep === 'number'
            ? parsed.mergeDetection.minImportanceForKeep
            : DEFAULT_THRESHOLDS.mergeDetection.minImportanceForKeep,
      },
      moveDetection: {
        crossDomainKeywordMatchThreshold:
          typeof parsed.moveDetection?.crossDomainKeywordMatchThreshold === 'number'
            ? parsed.moveDetection.crossDomainKeywordMatchThreshold
            : DEFAULT_THRESHOLDS.moveDetection.crossDomainKeywordMatchThreshold,
      },
    }
  } catch {
    return DEFAULT_THRESHOLDS
  }
}

/**
 * Jaccard similarity between two keyword sets.
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0

  let intersectionSize = 0
  for (const item of a) {
    if (b.has(item)) intersectionSize++
  }

  const unionSize = a.size + b.size - intersectionSize

  return unionSize === 0 ? 0 : intersectionSize / unionSize
}

/**
 * Extract the domain (first path segment) from a relative path.
 */
function extractDomain(relativePath: string): string {
  const firstSlash = relativePath.indexOf('/')

  return firstSlash === -1 ? relativePath : relativePath.slice(0, firstSlash)
}

// ── Entry metadata ──────────────────────────────────────────────────────────

interface EntryMetadata {
  domain: string
  importance: number
  keywords: Set<string>
  maturity: 'core' | 'draft' | 'validated'
  relativePath: string
}

async function readEntryMetadata(
  contextTreeDir: string,
  relativePath: string,
): Promise<EntryMetadata | null> {
  const absolutePath = join(contextTreeDir, relativePath)
  const content = await readFile(absolutePath, 'utf8')

  const parsed = parseFrontmatter(content)
  if (!parsed) return null

  const scoring = parseFrontmatterScoring(content)

  return {
    domain: extractDomain(relativePath),
    importance: scoring?.importance ?? 50,
    keywords: new Set(parsed.frontmatter.keywords.map((k) => k.toLowerCase())),
    maturity: scoring?.maturity ?? 'draft',
    relativePath,
  }
}

// ── Detection ───────────────────────────────────────────────────────────────

/**
 * Detect merge and move candidates from the context tree.
 *
 * - Merge: two entries in the same domain with high keyword overlap
 *   and at least one below importance threshold.
 * - Move: an entry whose keywords better match a different domain.
 */
export async function detectCandidates(params: {
  contextTreeDir: string
  templateContent: string
}): Promise<ReorgCandidate[]> {
  const {contextTreeDir, templateContent} = params
  const thresholds = parseThresholds(templateContent)

  // Walk all markdown files, skip derived artifacts
  const mdFiles = await glob('**/*.md', {cwd: contextTreeDir, nodir: true})
  const entries: EntryMetadata[] = []

  for (const relativePath of mdFiles) {
    if (isDerivedArtifact(relativePath)) continue

    const meta = await readEntryMetadata(contextTreeDir, relativePath)
    if (meta && meta.keywords.size > 0) {
      entries.push(meta)
    }
  }

  const candidates: ReorgCandidate[] = []

  // ── Merge detection ─────────────────────────────────────────────────────
  // Group entries by domain
  const byDomain = new Map<string, EntryMetadata[]>()
  for (const entry of entries) {
    const group = byDomain.get(entry.domain) ?? []
    group.push(entry)
    byDomain.set(entry.domain, group)
  }

  const mergedSeen = new Set<string>()

  for (const [, domainEntries] of byDomain) {
    for (let i = 0; i < domainEntries.length; i++) {
      for (let j = i + 1; j < domainEntries.length; j++) {
        const a = domainEntries[i]
        const b = domainEntries[j]

        const similarity = jaccardSimilarity(a.keywords, b.keywords)
        if (similarity < thresholds.mergeDetection.keywordOverlapThreshold) continue

        // At least one must be below importance threshold
        if (
          a.importance >= thresholds.mergeDetection.minImportanceForKeep &&
          b.importance >= thresholds.mergeDetection.minImportanceForKeep
        ) {
          continue
        }

        // Keep the higher-importance entry as target, merge the lower into it
        const [source, target] =
          a.importance <= b.importance ? [a, b] : [b, a]

        const pairKey = `${source.relativePath}::${target.relativePath}`
        if (mergedSeen.has(pairKey)) continue
        mergedSeen.add(pairKey)

        candidates.push({
          confidence: similarity,
          detectionMetadata: {
            sourceImportance: source.importance,
            targetImportance: target.importance,
          },
          reason: `Keyword overlap ${(similarity * 100).toFixed(0)}% in domain "${source.domain}"`,
          sourcePaths: [source.relativePath],
          targetPath: target.relativePath,
          type: 'merge',
        })
      }
    }
  }

  // ── Move detection ──────────────────────────────────────────────────────
  // Aggregate keywords per domain
  const domainKeywords = new Map<string, Set<string>>()
  for (const entry of entries) {
    const existing = domainKeywords.get(entry.domain) ?? new Set()
    for (const kw of entry.keywords) {
      existing.add(kw)
    }

    domainKeywords.set(entry.domain, existing)
  }

  for (const entry of entries) {
    const currentDomainKeywords = domainKeywords.get(entry.domain)
    const currentSimilarity = currentDomainKeywords
      ? jaccardSimilarity(entry.keywords, currentDomainKeywords)
      : 0

    let bestDomain: null | string = null
    let bestSimilarity = currentSimilarity

    for (const [domain, keywords] of domainKeywords) {
      if (domain === entry.domain) continue

      const similarity = jaccardSimilarity(entry.keywords, keywords)
      if (
        similarity >= thresholds.moveDetection.crossDomainKeywordMatchThreshold &&
        similarity > bestSimilarity
      ) {
        bestSimilarity = similarity
        bestDomain = domain
      }
    }

    if (bestDomain) {
      // Construct target path: same basename, different domain parent
      const currentDir = dirname(entry.relativePath)
      const currentDirSegments = currentDir.split('/')
      // Replace the first segment (domain) with the best-matching domain
      currentDirSegments[0] = bestDomain
      const targetDir = currentDirSegments.join('/')
      const fileName = entry.relativePath.split('/').at(-1) ?? ''
      const targetPath = `${targetDir}/${fileName}`

      candidates.push({
        confidence: bestSimilarity,
        detectionMetadata: {
          currentDomain: entry.domain,
          currentDomainSimilarity: currentSimilarity,
          targetDomain: bestDomain,
          targetDomainSimilarity: bestSimilarity,
        },
        reason: `Keywords better match domain "${bestDomain}" (${(bestSimilarity * 100).toFixed(0)}% vs ${(currentSimilarity * 100).toFixed(0)}%)`,
        sourcePaths: [entry.relativePath],
        targetPath,
        type: 'move',
      })
    }
  }

  return candidates
}
