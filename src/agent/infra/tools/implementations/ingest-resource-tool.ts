import {basename, isAbsolute, join, relative, resolve} from 'node:path'
import {z} from 'zod'

import type {Tool, ToolExecutionContext} from '../../../core/domain/tools/types.js'
import type {IContentGenerator} from '../../../core/interfaces/i-content-generator.js'
import type {CurateOperation} from '../../../core/interfaces/i-curate-service.js'
import type {IFileSystem} from '../../../core/interfaces/i-file-system.js'
import type {AbstractGenerationQueue} from '../../map/abstract-queue.js'

import {BRV_DIR, CONTEXT_TREE_DIR} from '../../../../server/constants.js'
import {ToolName} from '../../../core/domain/tools/constants.js'
import {executeLlmMapMemory} from '../../map/llm-map-memory.js'
import {executeCurate} from './curate-tool.js'

const DEFAULT_INCLUDE = ['**/*.ts', '**/*.md', '**/*.json', '**/*.js', '**/*.py', '**/*.go', '**/*.rs']
const DEFAULT_EXCLUDE = ['node_modules', '.git', '*.test.*', '*.spec.*', 'dist', 'build']
const MAX_FILES = 200
const MAX_FILE_LINES = 500
const MAX_CONTENT_CHARS = 4000

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
      const domain = params.domain ?? (basename(absPath) || 'imported')
      const include = params.include ?? DEFAULT_INCLUDE
      const exclude = params.exclude ?? DEFAULT_EXCLUDE

      // Step 1: Glob files — collect unique paths across all include patterns
      const seenPaths = new Set<string>()
      const rawPaths: string[] = []

      /* eslint-disable no-await-in-loop */
      for (const pattern of include) {
        const globResult = await fileSystem.globFiles(pattern, {
          cwd: absPath,
          maxResults: MAX_FILES,
          respectGitignore: true,
        })

        for (const file of globResult.files) {
          const relativePath = toRelativeUnixPath(absPath, file.path)
          if (relativePath.startsWith('../')) continue

          if (relativePath.split('/').length > params.depth) continue

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
            const relativePath = toRelativeUnixPath(absPath, filePath)
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
        concurrency: 8,
        generator: contentGenerator,
        items: fileItems.map((f) => ({content: f.content, path: f.path})),
        prompt: 'Extract key knowledge facts from this file.\n\nPath: {{path}}\n\nContent:\n{{content}}',
        taskId: context?.taskId,
      })
      if (mapResult.results.length !== fileItems.length) {
        throw new Error(
          `ingest_resource expected ${fileItems.length} mapped result(s), received ${mapResult.results.length}`,
        )
      }

      // Step 4: Convert to CurateOperations
      const operations: CurateOperation[] = []
      for (const [i, file] of fileItems.entries()) {
        const facts = mapResult.results[i]
        if (!facts || facts.length === 0) continue

        const fileBaseName = file.path.split('/').at(-1)?.replace(/\.[^.]+$/, '') ?? 'unknown'
        const topic = file.path.split('/').at(-2) ?? domain

        const highlights = facts.map((f) => `**${f.subject ?? 'Concept'}**: ${f.statement}`).join('\n\n')

        operations.push({
          content: {narrative: {highlights}},
          path: `${domain}/${topic}`,
          reason: `Ingested from ${file.path}`,
          title: fileBaseName,
          type: 'ADD',
        })
      }

      if (operations.length === 0) {
        return {domains: [domain], failed: mapResult.failed, ingested: 0, queued: 0}
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
        failed: mapResult.failed,
        ingested: curateResult.summary.added + curateResult.summary.updated,
        queued: abstractQueue ? operations.length : 0,
      }
    },

    id: ToolName.INGEST_RESOURCE,
    inputSchema: IngestResourceInputSchema,
  }
}
