/* eslint-disable no-await-in-loop */
import {glob} from 'glob'
import {readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import type {FrontmatterScoring} from './markdown-writer.js'

import {isArchiveStub, isDerivedArtifact} from '../../../infra/context-tree/derived-artifact.js'
import {generateFrontmatter, parseFrontmatter} from './markdown-writer.js'
import {normalizeRelationPath, RELATION_PATTERN} from './relation-parser.js'

/**
 * Rewrite relation references in a single markdown content string.
 *
 * Handles both frontmatter `related` arrays and legacy `@relation` body references.
 * Preserves all scoring metadata through the rewrite.
 *
 * @param content - Raw markdown content (with optional YAML frontmatter)
 * @param pathMapping - Map from old relation path → new relation path
 * @returns Updated content string, or null if nothing changed
 */
export function rewriteRelationsInContent(content: string, pathMapping: Map<string, string>): null | string {
  let changed = false

  const parsed = parseFrontmatter(content)

  let updatedBody: string
  let frontmatterBlock = ''

  if (parsed) {
    const {body, frontmatter} = parsed

    // Rewrite frontmatter related array
    const updatedRelated = frontmatter.related.map(rel => {
      const normalized = normalizeRelationPath(rel)
      const mapped = pathMapping.get(normalized)
      if (mapped) {
        changed = true

        return mapped
      }

      return rel
    })

    // Build scoring from parsed frontmatter fields
    const scoring: FrontmatterScoring = {
      accessCount: frontmatter.accessCount,
      createdAt: frontmatter.createdAt,
      importance: frontmatter.importance,
      maturity: frontmatter.maturity,
      recency: frontmatter.recency,
      updateCount: frontmatter.updateCount,
      updatedAt: frontmatter.updatedAt,
    }

    frontmatterBlock = generateFrontmatter(
      frontmatter.title ?? '',
      updatedRelated,
      frontmatter.tags,
      frontmatter.keywords,
      scoring,
    )

    updatedBody = body
  } else {
    updatedBody = content
  }

  // Rewrite legacy @relation body references
  const rewrittenBody = updatedBody.replaceAll(RELATION_PATTERN, (match, relationPath: string) => {
    const normalized = normalizeRelationPath(relationPath)
    const mapped = pathMapping.get(normalized)
    if (mapped) {
      changed = true

      return `@${mapped}`
    }

    return match
  })

  if (!changed) {
    return null
  }

  return parsed ? `${frontmatterBlock}${rewrittenBody}` : rewrittenBody
}

/**
 * Walk a context tree directory and rewrite relation references in all markdown files.
 *
 * Skips derived artifacts and archive stubs.
 * Only writes files that actually changed.
 *
 * @param contextTreeDir - Absolute path to context tree directory
 * @param pathMapping - Map from old relation path → new relation path
 * @returns Array of relative paths that were modified
 */
export async function rewriteRelationsInTree(contextTreeDir: string, pathMapping: Map<string, string>): Promise<string[]> {
  const mdFiles = await glob('**/*.md', {cwd: contextTreeDir, nodir: true})
  const modifiedPaths: string[] = []

  for (const relativePath of mdFiles) {
    if (isDerivedArtifact(relativePath) || isArchiveStub(relativePath)) {
      continue
    }

    const absolutePath = join(contextTreeDir, relativePath)
    const content = await readFile(absolutePath, 'utf8')
    const rewritten = rewriteRelationsInContent(content, pathMapping)

    if (rewritten !== null) {
      await writeFile(absolutePath, rewritten, 'utf8')
      modifiedPaths.push(relativePath)
    }
  }

  return modifiedPaths
}
