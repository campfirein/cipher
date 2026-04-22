#!/usr/bin/env npx ts-node --esm
/**
 * One-shot migration: ensure every context-tree markdown file has all
 * seven required semantic frontmatter fields.
 *
 * Usage:
 *   npx ts-node --esm scripts/migrate-frontmatter-complete.ts <context-tree-root>
 *   npx ts-node --esm scripts/migrate-frontmatter-complete.ts --dry-run <context-tree-root>
 */

import {dump as yamlDump, load as yamlLoad} from 'js-yaml'
import {readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs'
import {basename, join} from 'node:path'

// ── Constants (mirrored from src/server/constants.ts to avoid import-path issues) ──

const SUMMARY_INDEX_FILE = '_index.md'
const ARCHIVE_DIR = '_archived'
const STUB_EXTENSION = '.stub.md'

// ── Types ──

export interface MigrationResult {
  changed: number
  missingFields: Record<string, number>
  scanned: number
}

interface MigrationOptions {
  dryRun: boolean
}

// ── Required semantic fields ──

const REQUIRED_STRING_FIELDS = ['title', 'summary'] as const
const REQUIRED_ARRAY_FIELDS = ['tags', 'keywords', 'related'] as const
const REQUIRED_TIMESTAMP_FIELDS = ['createdAt', 'updatedAt'] as const

// ── Helpers ──

function isExcluded(filePath: string): boolean {
  const base = basename(filePath)
  if (base === SUMMARY_INDEX_FILE) return true
  if (base.endsWith(STUB_EXTENSION)) return true
  return false
}

function parseFrontmatterRaw(content: string): null | {body: string; parsed: Record<string, unknown>} {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return null
  }

  const endIndex = content.indexOf('\n---\n', 4)
  const endIndexCrlf = content.indexOf('\r\n---\r\n', 5)
  const actualEnd = endIndex === -1 ? endIndexCrlf : endIndex

  if (actualEnd < 0) {
    return null
  }

  const isCrlf = endIndex === -1
  const yamlBlock = content.slice(isCrlf ? 5 : 4, actualEnd)
  const delimiterLen = isCrlf ? 7 : 5  // '\r\n---\r\n' = 7, '\n---\n' = 5
  const body = content.slice(actualEnd + delimiterLen)

  try {
    const parsed = yamlLoad(yamlBlock) as null | Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') return null
    return {body, parsed}
  } catch {
    return null
  }
}

function findMissingFields(parsed: Record<string, unknown>): string[] {
  const missing: string[] = []
  for (const field of REQUIRED_STRING_FIELDS) {
    if (parsed[field] === undefined) missing.push(field)
  }

  for (const field of REQUIRED_ARRAY_FIELDS) {
    if (parsed[field] === undefined) missing.push(field)
  }

  for (const field of REQUIRED_TIMESTAMP_FIELDS) {
    if (parsed[field] === undefined) missing.push(field)
  }

  return missing
}

function buildCompleteFrontmatter(
  parsed: Record<string, unknown>,
  fileBirthtime: Date,
  fileMtime: Date,
): Record<string, unknown> {
  const createdAt = typeof parsed.createdAt === 'string'
    ? parsed.createdAt
    : (fileBirthtime.getTime() > 0 ? fileBirthtime : fileMtime).toISOString()
  const updatedAt = typeof parsed.updatedAt === 'string'
    ? parsed.updatedAt
    : fileMtime.toISOString()

  // Context-tree files carry exactly these 7 canonical semantic fields.
  // Legacy runtime-signal fields (importance, maturity, recency, accessCount,
  // updateCount) are intentionally not preserved — they are inert since the
  // sidecar migration (ENG-2133–ENG-2160).
  // Field order must match generateFrontmatter() output for idempotency.
  const fm: Record<string, unknown> = {}
  fm.title = typeof parsed.title === 'string' ? parsed.title : ''
  fm.summary = typeof parsed.summary === 'string' ? parsed.summary : ''
  fm.tags = Array.isArray(parsed.tags) ? parsed.tags : []
  fm.related = Array.isArray(parsed.related) ? parsed.related : []
  fm.keywords = Array.isArray(parsed.keywords) ? parsed.keywords : []
  fm.createdAt = createdAt
  fm.updatedAt = updatedAt
  return fm
}

function serializeFrontmatter(fm: Record<string, unknown>, body: string): string {
  const yamlContent = yamlDump(fm, {flowLevel: 1, lineWidth: -1, sortKeys: false}).trimEnd()
  return `---\n${yamlContent}\n---\n${body}`
}

function walkMdFiles(dir: string): string[] {
  const results: string[] = []
  let entries
  try {
    entries = readdirSync(dir, {withFileTypes: true})
  } catch {
    return results
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)

    if (entry.isDirectory()) {
      if (entry.name === ARCHIVE_DIR) continue
      results.push(...walkMdFiles(fullPath))
    } else if (entry.isFile() && entry.name.endsWith('.md') && !isExcluded(fullPath)) {
      results.push(fullPath)
    }
  }

  return results
}

// ── Main ──

export function migrateFrontmatter(rootDir: string, options: MigrationOptions): MigrationResult {
  const files = walkMdFiles(rootDir)
  const result: MigrationResult = {
    changed: 0,
    missingFields: {},
    scanned: files.length,
  }

  for (const filePath of files) {
    const content = readFileSync(filePath, 'utf8')
    const fm = parseFrontmatterRaw(content)

    if (!fm) continue // No frontmatter — skip

    const missing = findMissingFields(fm.parsed)
    if (missing.length === 0) continue

    // Track missing fields
    for (const field of missing) {
      result.missingFields[field] = (result.missingFields[field] ?? 0) + 1
    }

    const stat = statSync(filePath)
    const completeFm = buildCompleteFrontmatter(fm.parsed, stat.birthtime, stat.mtime)
    const newContent = serializeFrontmatter(completeFm, fm.body)

    // Byte-compare: only count as changed if content actually differs
    if (newContent === content) continue

    result.changed++

    if (!options.dryRun) {
      writeFileSync(filePath, newContent, 'utf8')
    }
  }

  return result
}

// ── CLI entry point ──

if (process.argv[1]?.endsWith('migrate-frontmatter-complete.ts') ||
    process.argv[1]?.endsWith('migrate-frontmatter-complete.js')) {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const rootDir = args.find(a => !a.startsWith('--'))

  if (!rootDir) {
    throw new Error('Usage: migrate-frontmatter-complete [--dry-run] <context-tree-root>')
  }

  console.log(`${dryRun ? '[DRY RUN] ' : ''}Migrating frontmatter in: ${rootDir}`)
  const result = migrateFrontmatter(rootDir, {dryRun})

  console.log(`\nScanned: ${result.scanned} files`)
  console.log(`Changed: ${result.changed} files`)

  if (Object.keys(result.missingFields).length > 0) {
    console.log('\nMissing fields:')
    for (const [field, count] of Object.entries(result.missingFields)) {
      console.log(`  ${field}: ${count} files`)
    }
  }

  if (dryRun && result.changed > 0) {
    console.log(`\n[DRY RUN] No files were modified. Re-run without --dry-run to apply changes.`)
  }
}
