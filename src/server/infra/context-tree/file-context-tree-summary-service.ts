/* eslint-disable camelcase */
/**
 * File-based implementation of IContextTreeSummaryService.
 *
 * Manages hierarchical summary nodes (_index.md) in the context tree.
 * Uses three-tier escalation (normal → aggressive → deterministic fallback)
 * following the same pattern as PreCompactionService.
 *
 * Fail-open: any error returns { actionTaken: false } — never blocks curation.
 */

import {readdir, readFile, stat, unlink, writeFile} from 'node:fs/promises'
import {dirname, join, relative} from 'node:path'

import type {ICipherAgent} from '../../../agent/core/interfaces/i-cipher-agent.js'
import type {
  CondensationOrder,
  StalenessCheckResult,
  SummaryFrontmatter,
  SummaryGenerationResult,
  SummaryLevel,
} from '../../core/domain/knowledge/summary-types.js'
import type {IContextTreeSummaryService} from '../../core/interfaces/context-tree/i-context-tree-summary-service.js'

import {BRV_DIR, CONTEXT_FILE_EXTENSION, CONTEXT_TREE_DIR, SUMMARY_INDEX_FILE} from '../../constants.js'
import {
  buildDeterministicFallbackCompaction,
  estimateTokens,
  isCompactionOutputValid,
  shouldAcceptCompactionOutput,
} from '../executor/pre-compaction/compaction-escalation.js'
import {computeChildrenHash} from './children-hash.js'
import {isArchiveStub, isDerivedArtifact} from './derived-artifact.js'
import {computeContentHash} from './hash-utils.js'
import {toUnixPath} from './path-utils.js'
import {buildSummarySystemPrompt, buildSummaryUserMessage} from './prompts/summary-generation.js'
import {generateSummaryContent, parseSummaryFrontmatter} from './summary-frontmatter.js'

interface ChildEntry {
  content: string
  contentHash: string
  name: string
  path: string
  tokens: number
}

const ZERO_RESULT: Omit<SummaryGenerationResult, 'path' | 'reason'> = {
  actionTaken: false,
  compressionRatio: 0,
  tokenCount: 0,
}

export class FileContextTreeSummaryService implements IContextTreeSummaryService {
  public async checkStaleness(directoryPath: string, directory?: string): Promise<StalenessCheckResult> {
    const baseDir = directory ?? process.cwd()
    const contextTreeDir = join(baseDir, BRV_DIR, CONTEXT_TREE_DIR)
    const targetDir = join(contextTreeDir, directoryPath)
    const indexPath = join(targetDir, SUMMARY_INDEX_FILE)

    // Collect current children
    const children = await this.collectInputs(targetDir, contextTreeDir)
    const currentHash = children.length > 0
      ? computeChildrenHash(children.map((c) => ({contentHash: c.contentHash, path: c.path})))
      : ''

    // Read existing _index.md
    let storedHash = ''
    try {
      const content = await readFile(indexPath, 'utf8')
      const fm = parseSummaryFrontmatter(content)
      storedHash = fm?.children_hash ?? ''
    } catch {
      // No _index.md exists
    }

    return {
      currentChildrenHash: currentHash,
      isStale: storedHash !== currentHash || storedHash === '',
      path: directoryPath,
      storedChildrenHash: storedHash,
    }
  }

  public async generateSummary(
    directoryPath: string,
    agent: ICipherAgent,
    directory?: string,
    parentTaskId?: string,
  ): Promise<SummaryGenerationResult> {
    const baseDir = directory ?? process.cwd()
    const contextTreeDir = join(baseDir, BRV_DIR, CONTEXT_TREE_DIR)
    const targetDir = join(contextTreeDir, directoryPath)

    try {
      // Step 1: Collect inputs (summary input set invariant)
      const children = await this.collectInputs(targetDir, contextTreeDir)
      if (children.length === 0) {
        return {...ZERO_RESULT, path: directoryPath, reason: 'empty_directory'}
      }

      // Step 2: Compute children hash
      const childrenHash = computeChildrenHash(
        children.map((c) => ({contentHash: c.contentHash, path: c.path})),
      )

      // Step 3: Determine condensation order from directory depth
      const depth = directoryPath === '.' || directoryPath === ''
        ? 0
        : directoryPath.split('/').length
      const order = this.depthToCondensationOrder(depth)
      const level = `d${order}` as SummaryLevel

      // Step 4: Total input tokens
      const totalInputTokens = children.reduce((sum, c) => sum + c.tokens, 0)

      // Step 5: Three-tier escalation via CipherAgent
      const taskId = parentTaskId ?? `summary_${directoryPath.replaceAll('/', '_') || 'root'}`
      const childEntries = children.map((c) => ({content: c.content, name: c.name}))
      let summaryText: string
      try {
        summaryText = await this.generateWithEscalation(agent, taskId, childEntries, level, totalInputTokens)
      } catch {
        const combinedInput = childEntries.map((entry) => `## ${entry.name}\n${entry.content}`).join('\n\n')
        summaryText = buildDeterministicFallbackCompaction({
          inputTokens: totalInputTokens,
          sourceText: combinedInput,
          suffixLabel: 'summary compaction',
        })
      }

      // Step 6: Write _index.md
      const summaryTokens = estimateTokens(summaryText)
      const frontmatter: SummaryFrontmatter = {
        children_hash: childrenHash,
        compression_ratio: totalInputTokens > 0 ? summaryTokens / totalInputTokens : 0,
        condensation_order: order,
        covers: children.map((c) => c.name).sort(),
        covers_token_total: totalInputTokens,
        summary_level: level,
        token_count: summaryTokens,
        type: 'summary',
      }

      const indexPath = join(targetDir, SUMMARY_INDEX_FILE)
      await writeFile(indexPath, generateSummaryContent(frontmatter, summaryText), 'utf8')

      return {
        actionTaken: true,
        compressionRatio: frontmatter.compression_ratio,
        path: directoryPath,
        tier: 'normal', // TODO: track actual tier from escalation
        tokenCount: summaryTokens,
      }
    } catch {
      return {...ZERO_RESULT, path: directoryPath, reason: 'llm_error'}
    }
  }

  public async hasSummary(directoryPath: string, directory?: string): Promise<boolean> {
    const baseDir = directory ?? process.cwd()
    const indexPath = join(baseDir, BRV_DIR, CONTEXT_TREE_DIR, directoryPath, SUMMARY_INDEX_FILE)

    try {
      await stat(indexPath)

      return true
    } catch {
      return false
    }
  }

  public async propagateStaleness(
    changedPaths: string[],
    agent: ICipherAgent,
    directory?: string,
    parentTaskId?: string,
  ): Promise<SummaryGenerationResult[]> {
    if (changedPaths.length === 0) return []

    // Collect unique parent directory paths, then walk upward to root
    const dirsToCheck = new Set<string>()
    for (const changedPath of changedPaths) {
      let dir = dirname(changedPath)
      while (dir && dir !== '.') {
        dirsToCheck.add(dir)
        dir = dirname(dir)
      }

      // Also include root
      dirsToCheck.add('.')
    }

    // Sort bottom-up (deepest first)
    const sorted = [...dirsToCheck].sort((a, b) => {
      const depthA = a === '.' ? 0 : a.split('/').length
      const depthB = b === '.' ? 0 : b.split('/').length

      return depthB - depthA
    })

    const results: SummaryGenerationResult[] = []
    const stoppedPaths = new Set<string>()

    /* eslint-disable no-await-in-loop */
    for (const dirPath of sorted) {
      // If a descendant of this dir was stopped due to error, skip it
      if (this.hasStoppedDescendant(dirPath, stoppedPaths)) continue

      const staleness = await this.checkStaleness(dirPath, directory)
      if (!staleness.isStale) continue

      const result = await this.generateSummary(dirPath, agent, directory, parentTaskId)
      results.push(result)

      if (!result.actionTaken) {
        if (result.reason === 'empty_directory') {
          // Delete stale _index.md and continue climbing (parent input set changed)
          try {
            const baseDir = directory ?? process.cwd()
            const indexPath = join(baseDir, BRV_DIR, CONTEXT_TREE_DIR, dirPath, SUMMARY_INDEX_FILE)
            await unlink(indexPath)
          } catch {
            // Already gone, fine
          }
        } else {
          // LLM/IO error: stop climbing from this node
          stoppedPaths.add(dirPath)
        }
      }
    }
    /* eslint-enable no-await-in-loop */

    return results
  }

  /**
   * Collect inputs for a summary (the summary input set invariant):
   * - Leaf .md files in the directory (excluding _index.md, _archived/)
   * - Child directory _index.md files (summaries of subdirectories)
   */
  private async collectInputs(targetDir: string, contextTreeDir: string): Promise<ChildEntry[]> {
    const children: ChildEntry[] = []

    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(targetDir, {withFileTypes: true}) as import('node:fs').Dirent[]
    } catch {
      return children
    }

    /* eslint-disable no-await-in-loop */
    for (const entry of entries) {
      const entryName = entry.name as string
      const fullPath = join(targetDir, entryName)
      const relativePath = toUnixPath(relative(contextTreeDir, fullPath))

      if (entry.isFile() && entryName.endsWith(CONTEXT_FILE_EXTENSION)) {
        // Skip _index.md itself and derived artifacts
        if (entryName === SUMMARY_INDEX_FILE) continue
        if (isDerivedArtifact(relativePath) || isArchiveStub(relativePath)) continue

        try {
          const content = await readFile(fullPath, 'utf8')
          children.push({
            content,
            contentHash: computeContentHash(content),
            name: entryName,
            path: relativePath,
            tokens: estimateTokens(content),
          })
        } catch {
          // Skip unreadable files
        }
      } else if (entry.isDirectory() && entryName !== '_archived') {
        // Check for child directory _index.md
        const childIndexPath = join(fullPath, SUMMARY_INDEX_FILE)
        try {
          const content = await readFile(childIndexPath, 'utf8')
          const childRelPath = toUnixPath(relative(contextTreeDir, childIndexPath))
          children.push({
            content,
            contentHash: computeContentHash(content),
            name: `${entryName}/${SUMMARY_INDEX_FILE}`,
            path: childRelPath,
            tokens: estimateTokens(content),
          })
        } catch {
          // No _index.md in child directory, skip
        }
      }
    }
    /* eslint-enable no-await-in-loop */

    return children
  }

  /**
   * Determine condensation order from directory depth relative to context tree root.
   * Root = d3, domain = d2, topic = d1, subtopic = d0
   */
  private depthToCondensationOrder(depth: number): CondensationOrder {
    if (depth === 0) return 3
    if (depth === 1) return 2
    if (depth === 2) return 1

    return 0
  }

  /**
   * Execute a single summary generation pass via the agent.
   */
  private async executeSummaryPass(
    agent: ICipherAgent,
    sessionId: string,
    taskId: string,
    childEntries: Array<{content: string; name: string}>,
    level: SummaryLevel,
    aggressive: boolean,
  ): Promise<string | undefined> {
    try {
      const systemPrompt = buildSummarySystemPrompt()
      const userMessage = buildSummaryUserMessage(childEntries, level, aggressive)
      const prompt = `${systemPrompt}\n\n${userMessage}`

      const response = await agent.executeOnSession(sessionId, prompt, {
        executionContext: {
          clearHistory: true,
          commandType: 'query',
          maxIterations: 1,
          maxTokens: 4096,
          temperature: 0.3,
        },
        taskId,
      })

      return response || undefined
    } catch {
      return undefined
    }
  }

  /**
   * Three-tier escalation for summary generation.
   * Follows the same pattern as PreCompactionService.compact().
   */
  private async generateWithEscalation(
    agent: ICipherAgent,
    taskId: string,
    childEntries: Array<{content: string; name: string}>,
    level: SummaryLevel,
    inputTokens: number,
  ): Promise<string> {
    const sessionId = await agent.createTaskSession(taskId, 'query')
    try {
      // Pass 1: Normal
      const normalResult = await this.executeSummaryPass(agent, sessionId, taskId, childEntries, level, false)
      if (normalResult && shouldAcceptCompactionOutput(normalResult, inputTokens) && isCompactionOutputValid(normalResult)) {
        return normalResult.trim()
      }

      // Pass 2: Aggressive
      const aggressiveResult = await this.executeSummaryPass(agent, sessionId, taskId, childEntries, level, true)
      if (aggressiveResult && shouldAcceptCompactionOutput(aggressiveResult, inputTokens) && isCompactionOutputValid(aggressiveResult)) {
        return aggressiveResult.trim()
      }

      // Pass 3: Deterministic fallback
      const combinedInput = childEntries.map((e) => `## ${e.name}\n${e.content}`).join('\n\n')

      return buildDeterministicFallbackCompaction({
        inputTokens,
        sourceText: combinedInput,
        suffixLabel: 'summary compaction',
      })
    } finally {
      try {
        // Cleanup is best-effort. A generated summary should still be written even
        // if the backing task session cannot be torn down cleanly.
        await agent.deleteTaskSession(sessionId)
      } catch {
        // Ignore cleanup failures
      }
    }
  }

  /**
   * Check if any descendant of dirPath was stopped due to LLM/IO error.
   * Since we process bottom-up (deepest first), a stopped child means
   * its parent should also stop to prevent regenerating from stale state.
   */
  private hasStoppedDescendant(dirPath: string, stoppedPaths: Set<string>): boolean {
    if (stoppedPaths.size === 0) return false

    const prefix = dirPath === '.' ? '' : `${dirPath}/`
    for (const stopped of stoppedPaths) {
      // dirPath is ancestor of stopped if stopped starts with dirPath/
      // Special case: dirPath '.' is ancestor of everything
      if (prefix === '' || stopped.startsWith(prefix)) {
        return true
      }
    }

    return false
  }
}
