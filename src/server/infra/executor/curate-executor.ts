import path from 'node:path'

import type {ICipherAgent} from '../../../agent/core/interfaces/i-cipher-agent.js'
import type {CurationStatus} from '../../core/domain/entities/curation-status.js'
import type {CurateExecuteOptions, ICurateExecutor} from '../../core/interfaces/executor/i-curate-executor.js'

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
import {DreamLockService} from '../dream/dream-lock-service.js'
import {DreamStateService} from '../dream/dream-state-service.js'
import {PreCompactionService} from './pre-compaction/pre-compaction-service.js'

type BackgroundDrainAgent = ICipherAgent & {drainBackgroundWork?: () => Promise<void>}

/**
 * CurateExecutor - Executes curate tasks with an injected CipherAgent.
 *
 * This is NOT a UseCase (which orchestrates business logic).
 * It's an Executor that wraps agent.execute() with curate-specific options.
 *
 * Architecture:
 * - AgentProcess injects the long-lived CipherAgent
 * - Event streaming is handled by agent-process (subscribes to agentEventBus)
 * - Transport handles task lifecycle (task:started, task:completed, task:error)
 * - Executor focuses solely on curate execution
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

  constructor(fileContentReader?: FileContentReader) {
    this.fileContentReader = fileContentReader ?? createFileContentReader()
  }

  /**
   * Synchronous wrapper kept for backwards compatibility — runs the agent body
   * AND awaits Phase 4 before returning. Equivalent to the pre-detach behaviour.
   *
   * agent-process uses runAgentBody directly so it can fire `task:completed`
   * after the agent body and queue Phase 4 to the PostWorkRegistry for
   * asynchronous execution.
   */
  public async executeWithAgent(agent: ICipherAgent, options: CurateExecuteOptions): Promise<string> {
    const {finalize, response} = await this.runAgentBody(agent, options)
    await finalize()
    return response
  }

  /**
   * Run the agent body (Phases 1–3) and return the response immediately along
   * with a `finalize` thunk that runs Phase 4 (snapshot diff, summary
   * regeneration, manifest rebuild, dream counter, background drain, task
   * session cleanup).
   *
   * The caller is responsible for invoking `finalize()` exactly once. The
   * thunk is fail-open by design: errors inside Phase 4 do not propagate.
   *
   * If the agent body itself throws, the task session is cleaned up before
   * the error propagates and no `finalize` is returned (the caller has
   * nothing to invoke).
   */
  public async runAgentBody(
    agent: ICipherAgent,
    options: CurateExecuteOptions,
  ): Promise<{finalize: () => Promise<void>; response: string}> {
    const {clientCwd, content, files, projectRoot, taskId} = options

    // --- Phase 1: Preprocessing (no sessions created yet — safe to throw) ---
    const fileReferenceInstructions = await this.processFileReferences(files ?? [], clientCwd)
    const fullContext = fileReferenceInstructions ? `${content}\n${fileReferenceInstructions}` : content

    // --- Phase 2: Pre-compaction (fail-open, manages its own session lifecycle) ---
    const compactionResult = await this.preCompactionService.compact(agent, fullContext, taskId)
    const effectiveContext = compactionResult.context

    // --- Phase 3: Curation (session created AFTER preprocessing + compaction) ---
    // Capture pre-curation state for snapshot diff (summary propagation)
    // Post-processing (snapshot, summary, manifest) operates on projectRoot where .brv/ lives.
    // worktreeRoot is a linked subdir — .brv/ does not exist there in linked setups.
    const baseDir = projectRoot ?? clientCwd ?? process.cwd()
    const snapshotService = new FileContextTreeSnapshotService({baseDirectory: baseDir})
    let preState: Map<string, import('../../core/domain/entities/context-tree-snapshot.js').FileState> | undefined
    try {
      preState = await snapshotService.getCurrentState(baseDir)
    } catch {
      // Fail-open: if snapshot fails, skip summary propagation
    }

    const taskSessionId = await agent.createTaskSession(taskId, 'curate', {mapRootEligible: true, userFacing: true})

    let response: string
    try {
      // Task-scoped variable names for RLM pattern.
      // Replace hyphens with underscores: UUIDs have hyphens which are invalid in JS identifiers,
      // so the LLM would naturally use underscores when writing code-exec calls — causing a
      // ReferenceError if the variable was stored under the hyphen version.
      const taskIdSafe = taskId.replaceAll('-', '_')
      const ctxVar = `__curate_ctx_${taskIdSafe}`
      const histVar = `__curate_hist_${taskIdSafe}`
      const metaVar = `__curate_meta_${taskIdSafe}`

      // Compute context metadata (RLM pattern — LM sees metadata, not raw content)
      const contextLines = effectiveContext.split('\n')
      const metadata = {
        charCount: effectiveContext.length,
        lineCount: contextLines.length,
        messageCount: (effectiveContext.match(/\n\n\[(USER|ASSISTANT)\]:/g) || []).length,
        ...(compactionResult.preCompacted && {
          originalCharCount: compactionResult.originalCharCount,
          preCompacted: true,
          preCompactionTier: compactionResult.preCompactionTier,
        }),
        preview: effectiveContext.slice(0, 500),
        type: 'string',
      }

      // Inject context, metadata, empty history, and taskId into the TASK session's sandbox
      const taskIdVar = `__taskId_${taskIdSafe}`
      agent.setSandboxVariableOnSession(taskSessionId, ctxVar, effectiveContext)
      agent.setSandboxVariableOnSession(taskSessionId, histVar, {entries: [], totalProcessed: 0})
      agent.setSandboxVariableOnSession(taskSessionId, metaVar, metadata)
      agent.setSandboxVariableOnSession(taskSessionId, taskIdVar, taskId)

      // Prompt with curation helpers guidance (tools.curation.* replaces manual infrastructure code)
      const prompt = [
        `Curate using RLM approach.`,
        `Context variable: ${ctxVar} (${metadata.charCount} chars, ${metadata.lineCount} lines, ${metadata.messageCount} messages)`,
        `History variable: ${histVar}`,
        `Metadata variable: ${metaVar}`,
        `Task ID variable: ${taskIdVar} (pass as bare variable, not a string)`,
        `IMPORTANT: Do NOT print raw context. Start with tools.curation.recon(${ctxVar}, ${metaVar}, ${histVar}) to assess.`,
        `For chunked extraction use tools.curation.mapExtract(). Pass taskId: ${taskIdVar} (bare variable).`,
        `IMPORTANT: Any code_exec call containing mapExtract MUST use timeout: 300000 on the code_exec tool call itself (not inside mapExtract options).`,
        `Use tools.curation.groupBySubject() and tools.curation.dedup() to organize extractions.`,
        `Verify via result.applied[].filePath — do NOT call readFile for verification.`,
      ].join('\n')

      // Execute on the task session (isolated sandbox + history)
      // Task lifecycle is managed by Transport (task:started, task:completed, task:error)
      response = await agent.executeOnSession(taskSessionId, prompt, {
        executionContext: {clearHistory: true, commandType: 'curate', maxIterations: 50},
        taskId,
      })

      // Parse curation status from agent response for status tracking
      this.lastStatus = this.parseCurationStatus(taskId, response)
    } catch (error) {
      // Agent body failed — clean up the session before rethrowing so we don't leak it.
      // No finalize is returned in this path (the caller has nothing to await).
      await agent.deleteTaskSession(taskSessionId)
      throw error
    }

    // Build the Phase 4 thunk. It captures the closure state (preState, baseDir,
    // agent, taskId, taskSessionId) and runs the post-curate work asynchronously.
    const finalize = async (): Promise<void> => {
      try {
        await this.propagateSummariesIfChanged({agent, baseDir, preState, snapshotService, taskId})
        await this.incrementDreamCounter(baseDir)
        await (agent as BackgroundDrainAgent).drainBackgroundWork?.()
      } finally {
        // Clean up entire task session (sandbox + history) in one call.
        // Lives in finally so it runs even if Phase 4 above throws.
        await agent.deleteTaskSession(taskSessionId)
      }
    }

    return {finalize, response}
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
   * Phase 4d: bump the dream-state curation counter. Fail-open — dream state
   * tracking is non-critical and must never block curate completion.
   */
  private async incrementDreamCounter(baseDir: string): Promise<void> {
    try {
      const dreamStateService = new DreamStateService({baseDir: path.join(baseDir, BRV_DIR)})
      await dreamStateService.incrementCurationCount()
    } catch {
      // Dream state tracking is non-critical
    }
  }

  /**
   * Parse curation status from the agent response.
   * Extracts JSON status block if present, otherwise infers from response text.
   */
  private parseCurationStatus(taskId: string, response: string): CurationStatus {
    const defaultSummary = { added: 0, deleted: 0, failed: 0, merged: 0, updated: 0 }
    const defaultVerification = { checked: 0, confirmed: 0, missing: [] as string[] }

    // Try to extract JSON status block from response (agent instructed to include it)
    try {
      const jsonMatch = /```json\n([\S\s]*?)\n```/.exec(response)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1])

        return {
          completedAt: new Date().toISOString(),
          status: parsed.summary?.failed > 0 ? 'partial' : 'success',
          summary: parsed.summary ?? defaultSummary,
          taskId,
          verification: parsed.verification ?? defaultVerification,
        }
      }
    } catch {
      // Ignore parse errors — fall through to heuristic
    }

    // Fallback: infer from response text
    return {
      completedAt: new Date().toISOString(),
      status: response.includes('failed') ? 'failed' : 'success',
      summary: defaultSummary,
      taskId,
      verification: defaultVerification,
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

  /**
   * Phase 4a–c: snapshot diff → propagateStaleness → opportunistic manifest rebuild.
   *
   * Acquires the DreamLockService PID-lock around the write block so a
   * concurrent dream (which writes the same `_index.md` / `_manifest.json`)
   * cannot interleave. Detached Phase 4 made this race reachable: with Phase
   * 4 inline, the daemon was busy and idle-trigger dream couldn't fire. With
   * Phase 4 detached, dream and curate's post-work can overlap. If the lock
   * is held (dream is running), this method skips propagation — dream's own
   * propagateStaleness covers the same changes, and the next curate catches
   * any residual diff. Fail-open: any error inside is swallowed so it cannot
   * block curate completion.
   */
  private async propagateSummariesIfChanged(ctx: PropagateSummariesContext): Promise<void> {
    const {agent, baseDir, preState, snapshotService, taskId} = ctx
    if (!preState) return

    const dreamLockService = new DreamLockService({baseDir: path.join(baseDir, BRV_DIR)})
    let acquireResult: Awaited<ReturnType<DreamLockService['tryAcquire']>>
    try {
      acquireResult = await dreamLockService.tryAcquire()
    } catch {
      return
    }

    if (!acquireResult.acquired) return

    let succeeded = false
    try {
      const postState = await snapshotService.getCurrentState(baseDir)
      const changedPaths = diffStates(preState, postState)
      if (changedPaths.length === 0) {
        succeeded = true
        return
      }

      const summaryService = new FileContextTreeSummaryService()
      const results = await summaryService.propagateStaleness(changedPaths, agent, baseDir, taskId)
      if (results.some((r) => r.actionTaken)) {
        const manifestService = new FileContextTreeManifestService({baseDirectory: baseDir})
        await manifestService.buildManifest(baseDir)
      }

      succeeded = true
    } catch {
      // Fail-open: summary/manifest errors never block curation
    } finally {
      await (succeeded
        ? dreamLockService.release()
        : dreamLockService.rollback(acquireResult.priorMtime)
      ).catch(() => {})
    }
  }
}

type PropagateSummariesContext = {
  agent: ICipherAgent
  baseDir: string
  preState: Map<string, import('../../core/domain/entities/context-tree-snapshot.js').FileState> | undefined
  snapshotService: FileContextTreeSnapshotService
  taskId: string
}
