import path from 'node:path'

import type {ICipherAgent} from '../../../agent/core/interfaces/i-cipher-agent.js'
import type {ISearchKnowledgeService} from '../../../agent/infra/sandbox/tools-sdk.js'
import type {CurationStatus} from '../../core/domain/entities/curation-status.js'
import type {CurateExecuteOptions, ICurateExecutor} from '../../core/interfaces/executor/i-curate-executor.js'

import {
  type CurationRunResult,
  type NodeContext,
  TopologicalCurationRunner,
} from '../../../agent/core/curation/flow/runner.js'
import {buildCurationDAG} from '../../../agent/infra/curation/flow/dag-builder.js'
import {loadExistingMemory} from '../../../agent/infra/curation/flow/existing-memory-loader.js'
import {buildLiveServices} from '../../../agent/infra/curation/flow/services-adapter.js'
import {BRV_DIR} from '../../constants.js'
import {FileValidationError} from '../../core/domain/errors/task-error.js'
import {
  createFileContentReader,
  type FileContentReader,
  type FileReadResult,
} from '../../utils/file-content-reader.js'
import {validateFileForCurate} from '../../utils/file-validator.js'
import {FileContextTreeManifestService} from '../context-tree/file-context-tree-manifest-service.js'
import {FileContextTreeSnapshotService} from '../context-tree/file-context-tree-snapshot-service.js'
import {FileContextTreeSummaryService} from '../context-tree/file-context-tree-summary-service.js'
import {diffStates} from '../context-tree/snapshot-diff.js'
import {DreamStateService} from '../dream/dream-state-service.js'
import {PreCompactionService} from './pre-compaction/pre-compaction-service.js'

type BackgroundDrainAgent = ICipherAgent & {drainBackgroundWork?: () => Promise<void>}

/**
 * Build a human-readable source name for the R-3 provenance envelope.
 * Handles the 0/1/few/many file cases cleanly:
 *   - 0 files       → 'cli-text'
 *   - 1 file        → that file's path
 *   - 2-3 files     → comma-joined
 *   - 4+ files      → first 3 + '+N more' summary
 *
 * Per PHASE-2.5-PLAN.md §3.4 — the executor's input is `options.files: string[]`
 * (not a scalar `filePath`), so a single name needs to summarize multi-file batches.
 */
function deriveProvenanceName(files?: string[]): string {
  if (!files || files.length === 0) return 'cli-text'
  if (files.length === 1) return files[0]
  if (files.length <= 3) return files.join(',')
  return `${files.slice(0, 3).join(',')}+${files.length - 3} more`
}

export interface CurateExecutorDeps {
  /** Override file content reader (primarily for testing). */
  readonly fileContentReader?: FileContentReader
  /**
   * Search service used by the curate-flow conflict-node to detect existing
   * subjects in the context tree. When omitted, conflict detection always
   * emits 'add' decisions (acceptable Phase 1 fallback in tests).
   */
  readonly searchService?: ISearchKnowledgeService
}

/**
 * CurateExecutor — executes curate tasks via the typed-slot DAG runner.
 *
 * Phase 1 cutover (plan/agent-driven-graph/PHASE-1-IMPLEMENTATION.md): the
 * monolithic 50-iteration agent loop is replaced by a deterministic DAG of
 * 7 nodes (recon → chunk → extract → group → dedup → conflict → write).
 * Service-bound nodes (extract, conflict, write) delegate via NodeServices
 * built by `services-adapter.ts`.
 *
 * Architecture:
 * - AgentProcess injects the long-lived CipherAgent + SearchKnowledgeService
 * - Event streaming flows through agent-process (subscribes to agentEventBus)
 * - Transport handles task lifecycle (task:started, task:completed, task:error)
 * - Post-processing (snapshot diff, summary propagation, dream state) is
 *   preserved verbatim from the pre-cutover path.
 */
export class CurateExecutor implements ICurateExecutor {
  /** Maximum content length per file in characters */
  private static readonly MAX_CONTENT_PER_FILE = 40_000
  /** Maximum number of files allowed in --files flag */
  private static readonly MAX_FILES = 5
  /** Maximum lines to read for text files */
  private static readonly MAX_LINES_PER_FILE = 2000
  /** Maximum pages to extract for PDFs */
  private static readonly MAX_PDF_PAGES = 50
  /** Last curation status — available for future status-check command */
  public lastStatus?: CurationStatus
  private readonly fileContentReader: FileContentReader
  private readonly preCompactionService = new PreCompactionService()
  private readonly searchService?: ISearchKnowledgeService

  constructor(deps?: CurateExecutorDeps) {
    this.fileContentReader = deps?.fileContentReader ?? createFileContentReader()
    this.searchService = deps?.searchService
  }

  public async executeWithAgent(agent: ICipherAgent, options: CurateExecuteOptions): Promise<string> {
    const {clientCwd, content, files, logId, projectRoot, taskId} = options

    // --- Phase 1: Preprocessing (no sessions created yet — safe to throw) ---
    const fileReferenceInstructions = await this.processFileReferences(files ?? [], clientCwd)
    const fullContext = fileReferenceInstructions ? `${content}\n${fileReferenceInstructions}` : content

    // --- Phase 2: Pre-compaction + task-session creation (parallel hoist).
    // These are independent: compact() produces effective context, createTaskSession()
    // produces the session ID. Running them concurrently hides ~5–10s of latency on
    // large contexts. If compaction throws while the session is being created (or
    // already created), we delete the orphan session before re-throwing to prevent
    // leaks. Phase 3's snapshot capture also parallelizes here.
    const baseDir = projectRoot ?? clientCwd ?? process.cwd()
    const snapshotService = new FileContextTreeSnapshotService({baseDirectory: baseDir})
    const compactionPromise = this.preCompactionService.compact(agent, fullContext, taskId)
    const sessionPromise = agent.createTaskSession(taskId, 'curate', {mapRootEligible: true, userFacing: true})
    // eslint-disable-next-line unicorn/no-useless-undefined -- explicit `undefined` keeps the awaited type narrow (Map<...> | undefined) instead of `void | Map<...>`
    const snapshotPromise = snapshotService.getCurrentState(baseDir).catch(() => undefined)

    let compactionResult
    let taskSessionId
    let preState: Map<string, import('../../core/domain/entities/context-tree-snapshot.js').FileState> | undefined
    try {
      ;[compactionResult, taskSessionId, preState] = await Promise.all([
        compactionPromise,
        sessionPromise,
        snapshotPromise,
      ])
    } catch (error) {
      // Orphan-session guard: if compaction throws but session creation succeeded,
      // delete the session before re-throwing so we don't leak it.
      // eslint-disable-next-line unicorn/no-useless-undefined -- explicit `undefined` for type clarity
      const settledSession = await sessionPromise.catch(() => undefined)
      if (settledSession !== undefined) {
        // eslint-disable-next-line unicorn/no-useless-undefined -- explicit `undefined` for type clarity
        await agent.deleteTaskSession(settledSession).catch(() => undefined)
      }

      throw error
    }

    const effectiveContext = compactionResult.context

    try {
      // --- Phase 3: Curation via the typed-slot DAG runner ---
      // No more 50-iteration agent loop. The DAG is deterministic; each
      // service-bound slot makes at most one LLM call (extract per chunk,
      // conflict per fact-set). See plan/agent-driven-graph/DESIGN.md.
      //
      // R-3 (PHASE-2.5-PLAN.md §3.4): derive provenance from `options.files`
      // (not options.filePath — the schema uses an array per i-curate-executor.ts:13)
      // and thread `logId` + `taskId` through buildLiveServices so each curated
      // leaf's `Reason` field carries cur-<id> + source provenance + statement preview.
      const services = buildLiveServices({
        agent,
        basePath: path.join(baseDir, BRV_DIR, 'context-tree'),
        logId,
        lookupSubject: async (subject) => {
          if (!this.searchService) return []
          return loadExistingMemory(this.searchService, [subject], {limitPerSubject: 3})
        },
        provenance: {
          name: deriveProvenanceName(files),
          type: files && files.length > 0 ? 'file' : 'text',
        },
        taskId,
      })

      const metadata = {
        charCount: effectiveContext.length,
        lineCount: effectiveContext.split('\n').length,
        messageCount: (effectiveContext.match(/\n\n\[(USER|ASSISTANT)\]:/g) || []).length,
        ...(compactionResult.preCompacted && {
          originalCharCount: compactionResult.originalCharCount,
          preCompacted: true,
          preCompactionTier: compactionResult.preCompactionTier,
        }),
      }

      // initialInput carries the original context for chunk-node and the
      // recon inputs for recon-node. `existing` was previously here but is
      // now dead — services.detectConflicts sources its own existing memory
      // via the lookupSubject closure above (see runner.ts NodeServices doc).
      //
      // R-5 (PHASE-2.6-PLAN.md §3.1): rolled back from 8 → 4 per Phase 2.5
      // §3.5 go/no-go gate. Phase 4 UAT showed c=8 regressed Scenario 3 from
      // 150s (Phase 3 baseline) → 169s, most likely from gpt-5.4-mini
      // rate-limit retries. The 30s gap to ≤120s spec moves to a Phase 6
      // perf spike with profiler-driven measurements (don't guess-and-rerun).
      const ctx: NodeContext = {
        extractConcurrency: 4,
        initialInput: {
          context: effectiveContext,
          history: {entries: [], totalProcessed: 0},
          meta: metadata,
        },
        services,
        taskId,
      }

      const dag = buildCurationDAG()
      const runner = new TopologicalCurationRunner()
      const runResult = await runner.run(dag, ctx)

      this.lastStatus = this.adaptToStatus(taskId, runResult)
      const response = this.formatResponseString(runResult)

      // --- Phase 4: Post-curation summary propagation (fail-open) ---
      if (preState) {
        try {
          const postState = await snapshotService.getCurrentState(baseDir)
          const changedPaths = diffStates(preState, postState)
          if (changedPaths.length > 0) {
            const summaryService = new FileContextTreeSummaryService()
            const results = await summaryService.propagateStaleness(changedPaths, agent, baseDir)

            // Opportunistic manifest rebuild (pre-warm for next query)
            if (results.some((r) => r.actionTaken)) {
              const manifestService = new FileContextTreeManifestService({baseDirectory: baseDir})
              await manifestService.buildManifest(baseDir)
            }
          }
        } catch {
          // Fail-open: summary/manifest errors never block curation
        }
      }

      // Increment dream curation counter (fail-open: non-critical for curation)
      try {
        const dreamStateService = new DreamStateService({baseDir: path.join(baseDir, BRV_DIR)})
        await dreamStateService.incrementCurationCount()
      } catch {
        // Dream state tracking is non-critical — don't block curation
      }

      await (agent as BackgroundDrainAgent).drainBackgroundWork?.()

      return response
    } finally {
      // Clean up entire task session (sandbox + history) in one call
      await agent.deleteTaskSession(taskSessionId)
    }
  }

  /**
   * Build a CurationStatus from the runner result. Pulls counts from the
   * write-node's output; reports 'partial' if any slot failure occurred.
   */
  private adaptToStatus(taskId: string, result: CurationRunResult): CurationStatus {
    const defaultSummary = {added: 0, deleted: 0, failed: 0, merged: 0, updated: 0}
    const writeOutput = result.outputs.get('write') as
      | undefined
      | {applied: ReadonlyArray<unknown>; summary: typeof defaultSummary}

    const summary = writeOutput?.summary ?? defaultSummary
    const status: CurationStatus['status'] =
      result.failures.length > 0 ? 'partial' : summary.failed > 0 ? 'partial' : 'success'

    return {
      completedAt: new Date().toISOString(),
      status,
      summary,
      taskId,
      verification: {checked: 0, confirmed: 0, missing: []},
    }
  }

  /**
   * Format file contents for inclusion in the prompt.
   */
  private formatFileContentsForPrompt(
    readResults: FileReadResult[],
    skippedFiles: Array<{path: string; reason: string}>,
    projectRoot: string,
  ): string {
    const instructions: string[] = ['\n## File Contents (pre-loaded from --files flag)', '']

    // Separate successful and failed reads
    const successfulReads = readResults.filter((r) => r.success)
    const failedReads = readResults.filter((r) => !r.success)

    // Add successful file contents
    for (const result of successfulReads) {
      const relativePath = path.relative(projectRoot, result.filePath)
      const typeLabel = this.getFileTypeLabel(result.fileType)
      const truncatedNote = result.metadata?.truncated ? ' [truncated]' : ''

      instructions.push(`### File: ${relativePath} (${typeLabel}${truncatedNote})`, '```', result.content, '```', '')
    }

    // Add warnings for failed reads and skipped files
    if (failedReads.length > 0 || skippedFiles.length > 0) {
      instructions.push(
        '### Files that could not be read:',
        ...failedReads.map((r) => `- ${path.relative(projectRoot, r.filePath)}: ${r.error}`),
        ...skippedFiles.map((f) => `- ${f.path}: ${f.reason}`),
        '',
        '**Note:** You may use `read_file` or `grep_content` tools to find additional context if needed.',
        '',
      )
    }

    instructions.push(
      '**INSTRUCTIONS:**',
      '- The file contents above have been pre-loaded for you',
      '- Use this content to understand the context and create comprehensive knowledge topics',
      '- DO NOT use read_file tool for the files above - the content is already provided',
      '- Proceed with the normal workflow: detect domains, find existing knowledge, create/update topics',
      '- PRESERVE all diagrams (Mermaid, PlantUML, ASCII art) verbatim using narrative.diagrams array',
      '- PRESERVE all tables with every row - do not summarize table data',
      '- PRESERVE exact code examples, API signatures, and interface definitions',
      '- PRESERVE step-by-step procedures and numbered instructions in narrative.rules',
      '',
    )

    return instructions.join('\n')
  }

  /**
   * Format the runner result as a transport-compatible response string.
   * Wraps the write summary in the JSON-status block shape that downstream
   * consumers (TUI, MCP) parse via regex.
   */
  private formatResponseString(result: CurationRunResult): string {
    const defaultSummary = {added: 0, deleted: 0, failed: 0, merged: 0, updated: 0}
    const writeOutput = result.outputs.get('write') as
      | undefined
      | {applied: ReadonlyArray<unknown>; summary: typeof defaultSummary}

    const summary = writeOutput?.summary ?? defaultSummary
    const failures = result.failures.length > 0 ? `\nFailures: ${JSON.stringify(result.failures)}` : ''

    return `Curate completed via typed-slot DAG.${failures}\n\n\`\`\`json\n${JSON.stringify(
      {summary, verification: {checked: 0, confirmed: 0, missing: []}},
      null,
      2,
    )}\n\`\`\``
  }

  /**
   * Get human-readable label for file type.
   */
  private getFileTypeLabel(fileType: string): string {
    switch (fileType) {
      case 'office': {
        return 'Office Document'
      }

      case 'pdf': {
        return 'PDF'
      }

      case 'text': {
        return 'Text'
      }

      default: {
        return fileType
      }
    }
  }

  /**
   * Process file paths from --files flag.
   * Now reads file contents directly using FileContentReader.
   *
   * @param filePaths - Array of file paths (relative or absolute)
   * @param clientCwd - Client's working directory for file validation (optional, defaults to process.cwd())
   * @returns Formatted content with pre-read file contents
   * @throws {FileValidationError} If all files fail validation
   */
  private async processFileReferences(filePaths: string[], clientCwd?: string): Promise<string> {
    if (!filePaths || filePaths.length === 0) {
      return ''
    }

    // Truncate if exceeds max files
    let processedPaths = filePaths
    if (filePaths.length > CurateExecutor.MAX_FILES) {
      processedPaths = filePaths.slice(0, CurateExecutor.MAX_FILES)
    }

    const projectRoot = clientCwd ?? process.cwd()

    // Validate each file - skip non-existent files with warnings instead of failing
    const validPaths: string[] = []
    const skippedFiles: Array<{path: string; reason: string}> = []

    for (const filePath of processedPaths) {
      const result = validateFileForCurate(filePath, projectRoot)

      if (result.valid && result.normalizedPath) {
        validPaths.push(result.normalizedPath)
      } else {
        // Skip non-existent files instead of failing - agent can use grep to find alternatives
        skippedFiles.push({path: filePath, reason: result.error ?? 'Unknown error'})
      }
    }

    // If all files were skipped, throw an error
    if (validPaths.length === 0 && processedPaths.length > 0) {
      const errorMessage = `All specified files are invalid or do not exist:\n${skippedFiles.map((f) => `  - ${f.path}: ${f.reason}`).join('\n')}\n\nTry using grep to find the correct file paths.`
      throw new FileValidationError(errorMessage)
    }

    // Read file contents using FileContentReader
    const readResults = await this.fileContentReader.readFiles(validPaths, {
      maxContentLength: CurateExecutor.MAX_CONTENT_PER_FILE,
      maxLinesPerFile: CurateExecutor.MAX_LINES_PER_FILE,
      maxPdfPages: CurateExecutor.MAX_PDF_PAGES,
    })

    // Format with actual content
    return this.formatFileContentsForPrompt(readResults, skippedFiles, projectRoot)
  }
}
