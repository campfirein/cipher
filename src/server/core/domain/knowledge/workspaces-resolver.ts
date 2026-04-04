import {existsSync, readdirSync, realpathSync} from 'node:fs'
import {basename, join, resolve} from 'node:path'

import {BRV_DIR, CONTEXT_TREE_DIR, PROJECT_CONFIG_FILE} from '../../../constants.js'
import {deriveSourceKey, type KnowledgeSource} from './knowledge-source.js'

/**
 * Resolves workspace entries (relative paths or simple globs) into KnowledgeSource[].
 *
 * Supports:
 * - Relative paths: `../shared-lib`
 * - Simple single-level globs: `packages/*`
 *
 * Each resolved directory must have `.brv/config.json` AND `.brv/context-tree/` to be included.
 * Broken or invalid paths are silently skipped.
 */
export function resolveWorkspaces(projectRoot: string, workspaces: string[]): KnowledgeSource[] {
  const sources: KnowledgeSource[] = []
  const seen = new Set<string>()

  for (const entry of workspaces) {
    const resolved = resolveEntry(projectRoot, entry)
    for (const dir of resolved) {
      const source = tryBuildSource(dir, seen)
      if (source) {
        sources.push(source)
      }
    }
  }

  return sources
}

function resolveEntry(projectRoot: string, entry: string): string[] {
  // Only prefix/* globs are supported
  if (entry.endsWith('/*')) {
    return expandGlob(projectRoot, entry)
  }

  // Warn on unsupported glob patterns that would silently resolve to a literal path
  if (entry.includes('*')) {
    console.warn(`Warning: unsupported glob pattern "${entry}" in workspaces.json — only "prefix/*" is supported`)
    return []
  }

  return [resolve(projectRoot, entry)]
}

function expandGlob(projectRoot: string, pattern: string): string[] {
  const prefix = pattern.slice(0, -2) // strip /*
  const parentDir = resolve(projectRoot, prefix)

  if (!existsSync(parentDir)) {
    return []
  }

  try {
    const entries = readdirSync(parentDir, {withFileTypes: true})
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => join(parentDir, e.name))
  } catch {
    return []
  }
}

function tryBuildSource(dir: string, seen: Set<string>): KnowledgeSource | null {
  if (!existsSync(dir)) {
    return null
  }

  let canonicalDir: string
  try {
    canonicalDir = realpathSync(dir)
  } catch {
    return null
  }

  if (seen.has(canonicalDir)) {
    return null
  }

  const configPath = join(canonicalDir, BRV_DIR, PROJECT_CONFIG_FILE)
  if (!existsSync(configPath)) {
    return null
  }

  const contextTreeRoot = join(canonicalDir, BRV_DIR, CONTEXT_TREE_DIR)
  if (!existsSync(contextTreeRoot)) {
    return null
  }

  seen.add(canonicalDir)

  return {
    alias: basename(canonicalDir),
    contextTreeRoot,
    sourceKey: deriveSourceKey(canonicalDir),
    type: 'linked',
  }
}
