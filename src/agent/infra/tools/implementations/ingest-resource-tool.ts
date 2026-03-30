import {realpath} from 'node:fs/promises'
import {basename, isAbsolute, join, relative, resolve} from 'node:path'
import {z} from 'zod'

import type {Tool, ToolExecutionContext} from '../../../core/domain/tools/types.js'
import type {IContentGenerator} from '../../../core/interfaces/i-content-generator.js'
import type {CurateOperation} from '../../../core/interfaces/i-curate-service.js'
import type {IFileSystem} from '../../../core/interfaces/i-file-system.js'
import type {AbstractGenerationQueue} from '../../map/abstract-queue.js'
import type {CurationFact} from '../../sandbox/curation-helpers.js'

import {BRV_DIR, CONTEXT_TREE_DIR} from '../../../../server/constants.js'
import {ToolName} from '../../../core/domain/tools/constants.js'
import {executeLlmMapMemory} from '../../map/llm-map-memory.js'
import {executeCurate} from './curate-tool.js'

const DEFAULT_INCLUDE = ['**/*.ts', '**/*.md', '**/*.json', '**/*.js', '**/*.py', '**/*.go', '**/*.rs']
const DEFAULT_EXCLUDE = ['node_modules', '.git', '*.test.*', '*.spec.*', 'dist', 'build']
const MAX_FILES = 200
const MAX_FILE_LINES = 500
const MAX_CONTENT_CHARS = 4000

type IngestFileItem = {content: string; path: string}

function toRelativeUnixPath(rootPath: string, filePath: string): string {
  const relativePath = isAbsolute(filePath) ? relative(rootPath, filePath) : filePath
  return relativePath.replaceAll('\\', '/')
}

function matchesExcludePattern(relativePath: string, pattern: string): boolean {
  const normalizedPath = relativePath.replaceAll('\\', '/')
  const normalizedPattern = pattern.replaceAll('\\', '/')

  if (!normalizedPattern.includes('*')) {
    return normalizedPath.split('/').includes(normalizedPattern)
  }

  const regexPattern = normalizedPattern
    .replaceAll('.', String.raw`\.`)
    .replaceAll('**', '<<<DOUBLESTAR>>>')
    .replaceAll('*', '[^/]*')
    .replaceAll('<<<DOUBLESTAR>>>', '.*')

  return new RegExp(`^${regexPattern}$|/${regexPattern}$|^${regexPattern}/|/${regexPattern}/`).test(normalizedPath)
}

function getDirectoryDepth(relativePath: string): number {
  if (!relativePath) return 0
  return Math.max(0, relativePath.split('/').length - 1)
}

function extractHeading(content: string): string | undefined {
  const headingMatch = content.match(/^#\s+(.+)$/m)
  return headingMatch?.[1]?.trim()
}

function normalizeInlineText(content: string): string {
  return content.replaceAll(/\s+/g, ' ').trim()
}

function buildFallbackHighlights(content: string): string | undefined {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8)

  return lines.length > 0 ? lines.join('\n') : undefined
}

function getIngestTarget(filePath: string): {fileBaseName: string; topic: string} {
  const pathSegments = filePath.split('/')
  const fileBaseName = pathSegments.at(-1)?.replace(/\.[^.]+$/, '') ?? 'unknown'
  const topic = pathSegments.length > 1 ? (pathSegments.at(-2) ?? fileBaseName) : fileBaseName

  return {fileBaseName, topic}
}

function buildFallbackFacts(file: IngestFileItem): CurationFact[] {
  const {fileBaseName} = getIngestTarget(file.path)
  const heading = extractHeading(file.content) ?? fileBaseName
  const preview = normalizeInlineText(file.content).slice(0, 220)
  const subject = normalizeInlineText(heading).toLowerCase().replaceAll(/[^a-z0-9]+/g, '_').replaceAll(/^_+|_+$/g, '')

  return [{
    statement: preview.length > 0
      ? `${heading} is captured in ${file.path}: ${preview}`
      : `${heading} is captured in ${file.path}.`,
    ...(subject.length > 0 && {subject}),
  }]
}

function buildOperation(
  domain: string,
  sourceRoot: string,
  file: IngestFileItem,
  facts: CurationFact[] | null,
): CurateOperation | null {
  const {fileBaseName, topic} = getIngestTarget(file.path)
  const usableFacts = facts?.filter((fact) => fact.statement.trim().length > 0) ?? []
  const sourcePath = join(sourceRoot, file.path)

  if (usableFacts.length > 0) {
    const highlights = usableFacts.map((fact) => `**${fact.subject ?? 'Concept'}**: ${fact.statement}`).join('\n\n')

    return {
      content: {
        narrative: {highlights},
        rawConcept: {files: [sourcePath]},
      },
      path: `${domain}/${topic}`,
      reason: `Ingested from ${file.path}`,
      title: fileBaseName,
      type: 'ADD',
    }
  }

  const fallbackFacts = buildFallbackFacts(file)
  const fallbackHighlights = buildFallbackHighlights(file.content)
  if (fallbackFacts.length === 0 && !fallbackHighlights) {
    return null
  }

  return {
    content: {
      facts: fallbackFacts,
      ...(fallbackHighlights && {narrative: {highlights: fallbackHighlights}}),
      rawConcept: {files: [sourcePath]},
      snippets: [file.content],
    },
    path: `${domain}/${topic}`,
    reason: `Fallback ingest from ${file.path}`,
    title: fileBaseName,
    type: 'ADD',
  }
}

const IngestResourceInputSchema = z
  .object({
    depth: z.number().int().min(1).max(5).optional().default(3).describe('Maximum directory depth to scan (default: 3, max: 5)'),
    domain: z.string().optional().describe('Target knowledge domain (default: inferred from directory name)'),
    exclude: z.array(z.string()).optional().describe('Glob patterns to exclude (default: node_modules, .git, *.test.*, dist, build)'),
    include: z.array(z.string()).optional().describe('Glob patterns to include (default: *.ts, *.md, *.json, etc.)'),
    path: z.string().min(1).describe('Directory path to ingest files from'),
  })
  .strict()

type IngestInput = z.infer<typeof IngestResourceInputSchema>

export interface IngestResourceConfig {
  abstractQueue?: AbstractGenerationQueue
  baseDirectory?: string
  contentGenerator?: IContentGenerator
  fileSystem?: IFileSystem
}

/**
 * Creates the ingest_resource tool.
 *
 * Bulk-ingests files from a directory into the knowledge context tree.
 * Glob → Read → LLM extraction → Curate pipeline.
 */
export function createIngestResourceTool(config: IngestResourceConfig = {}): Tool {
  return {
    description:
      'Bulk-ingest files from a directory into the knowledge context tree. ' +
      'Globs files, reads contents, extracts knowledge via LLM, and adds to context tree. ' +
      'Use for one-shot import of documentation, source files, or configuration.',

    async execute(input: unknown, context?: ToolExecutionContext): Promise<unknown> {
      const params = IngestResourceInputSchema.parse(input) as IngestInput
      const {abstractQueue, baseDirectory, contentGenerator, fileSystem} = config

      if (!contentGenerator || !fileSystem) {
        throw new Error('ingest_resource requires contentGenerator and fileSystemService')
      }

      // Normalize to absolute using the injected workspace root so relative inputs like './src'
      // resolve against the project directory, not the agent process cwd.
      const absPath = resolve(baseDirectory ?? process.cwd(), params.path)
      const normalizedAbsPath = await realpath(absPath).catch(() => absPath)
      const domain = params.domain ?? (basename(absPath) || 'imported')
      const include = params.include ?? DEFAULT_INCLUDE
      const exclude = params.exclude ?? DEFAULT_EXCLUDE

      // Step 1: Glob files — collect unique paths across all include patterns
      const seenPaths = new Set<string>()
      const rawPaths: string[] = []

      /* eslint-disable no-await-in-loop */
      for (const pattern of include) {
        const globResult = await fileSystem.globFiles(pattern, {
          cwd: normalizedAbsPath,
          maxResults: MAX_FILES,
          respectGitignore: true,
        })

        for (const file of globResult.files) {
          const relativePath = toRelativeUnixPath(normalizedAbsPath, file.path)
          if (relativePath.startsWith('../')) continue

          if (getDirectoryDepth(relativePath) > params.depth) continue

          const excluded = exclude.some((pattern) => matchesExcludePattern(relativePath, pattern))
          if (!excluded && !seenPaths.has(file.path)) {
            seenPaths.add(file.path)
            rawPaths.push(file.path)
          }
        }
      }
      /* eslint-enable no-await-in-loop */

      // Step 2: Read file contents (limit to MAX_FILES)
      const fileItems: Array<{content: string; path: string}> = []

      /* eslint-disable no-await-in-loop */
      for (const filePath of rawPaths.slice(0, MAX_FILES)) {
        try {
          const {content} = await fileSystem.readFile(filePath, {limit: MAX_FILE_LINES})
          if (content.trim()) {
            const relativePath = toRelativeUnixPath(normalizedAbsPath, filePath)
            if (relativePath.startsWith('../')) continue
            fileItems.push({content: content.slice(0, MAX_CONTENT_CHARS), path: relativePath})
          }
        } catch {
          // Skip unreadable files
        }
      }
      /* eslint-enable no-await-in-loop */

      if (fileItems.length === 0) {
        return {domains: [domain], failed: 0, ingested: 0, queued: 0}
      }

      // Step 3: LLM extraction via executeLlmMapMemory
      const mapResult = await executeLlmMapMemory({
        concurrency: Math.min(4, Math.max(1, fileItems.length)),
        generator: contentGenerator,
        items: fileItems.map((f) => ({content: f.content, path: f.path})),
        prompt:
          'Extract 1-5 concrete reusable knowledge facts from the file provided in the map details below. ' +
          'Focus on APIs, invariants, workflows, configuration, constraints, and implementation semantics. ' +
          'Each fact should be a terse technical statement.',
        taskId: context?.taskId,
      })
      if (mapResult.results.length !== fileItems.length) {
        throw new Error(
          `ingest_resource expected ${fileItems.length} mapped result(s), received ${mapResult.results.length}`,
        )
      }

      // Step 4: Convert to CurateOperations
      const operations: CurateOperation[] = []
      let unresolvedCount = 0
      for (const [i, file] of fileItems.entries()) {
        const operation = buildOperation(domain, normalizedAbsPath, file, mapResult.results[i])
        if (operation) {
          operations.push(operation)
        } else {
          unresolvedCount++
        }
      }

      if (operations.length === 0) {
        return {domains: [domain], failed: fileItems.length, ingested: 0, queued: 0}
      }

      // Step 5: Run curate pipeline with abstract queue hook.
      // basePath must point to the knowledge store (.brv/context-tree), not the workspace root.
      const contextTreePath = join(baseDirectory ?? process.cwd(), BRV_DIR, CONTEXT_TREE_DIR)
      const curateResult = await executeCurate(
        {basePath: contextTreePath, operations},
        context,
        abstractQueue,
      )

      return {
        domains: [domain],
        failed: unresolvedCount,
        ingested: curateResult.summary.added + curateResult.summary.updated,
        queued: abstractQueue ? operations.length : 0,
      }
    },

    id: ToolName.INGEST_RESOURCE,
    inputSchema: IngestResourceInputSchema,
  }
}
