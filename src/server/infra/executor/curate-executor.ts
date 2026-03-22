import path from 'node:path'

import type {StreamingEvent} from '../../../agent/core/domain/streaming/types.js'
import type {ICipherAgent} from '../../../agent/core/interfaces/i-cipher-agent.js'
import type {CurateLogOperation} from '../../core/domain/entities/curate-log-entry.js'
import type {CurationStatus} from '../../core/domain/entities/curation-status.js'
import type {CurateExecuteOptions, ICurateExecutor} from '../../core/interfaces/executor/i-curate-executor.js'
import type {HarnessNode} from '../../core/interfaces/harness/i-harness-tree-store.js'
import type {CurationHarnessService, CurationTemplateSelection} from '../harness/curation/curation-harness-service.js'

import {SessionCancelledError} from '../../../agent/core/domain/errors/session-error.js'
import {FileValidationError} from '../../core/domain/errors/task-error.js'
import {extractCurateOperations} from '../../utils/curate-result-parser.js'
import {
  createFileContentReader,
  type FileContentReader,
  type FileReadResult,
} from '../../utils/file-content-reader.js'
import {validateFileForCurate} from '../../utils/file-validator.js'
import {capturePreState, postTreeMutationMaintenance} from '../context-tree/post-mutation-maintenance.js'
import {extractOperationsFromResponse} from '../harness/curation/curation-feedback-collector.js'
import {buildTemplatePrompt, buildTemplateStreamOptions} from '../harness/curation/curation-template-executor.js'
import {computeSummary} from '../process/curate-log-handler.js'
import {PreCompactionService} from './pre-compaction/pre-compaction-service.js'

class FastPathExecutionError extends Error {
  constructor(
    message: string,
    public readonly curateOps: CurateLogOperation[],
    public readonly terminalReason: string,
  ) {
    super(message)
    this.name = 'FastPathExecutionError'
  }
}

class FastPathFallbackError extends Error {
  constructor(public readonly terminalReason: string) {
    super(`Fast path should fall back to the full agent loop (${terminalReason})`)
    this.name = 'FastPathFallbackError'
  }
}

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
  private readonly harnessService?: CurationHarnessService
  private readonly preCompactionService = new PreCompactionService()

  constructor(fileContentReader?: FileContentReader, harnessService?: CurationHarnessService) {
    this.fileContentReader = fileContentReader ?? createFileContentReader()
    this.harnessService = harnessService
  }

  public async executeWithAgent(agent: ICipherAgent, options: CurateExecuteOptions): Promise<string> {
    const {clientCwd, content, files, taskId} = options

    // --- Phase 1: Preprocessing (no sessions created yet — safe to throw) ---
    const fileReferenceInstructions = await this.processFileReferences(files ?? [], clientCwd)
    const fullContext = fileReferenceInstructions ? `${content}\n${fileReferenceInstructions}` : content

    // --- Phase 2: Pre-compaction (fail-open, manages its own session lifecycle) ---
    const compactionResult = await this.preCompactionService.compact(agent, fullContext, taskId)
    const effectiveContext = compactionResult.context

    // Capture pre-curation state for snapshot diff (shared post-mutation maintenance)
    const baseDir = clientCwd ?? process.cwd()
    const preState = await capturePreState(baseDir)

    // --- Phase 2.5: Template Selection (optional, fail-open) ---
    // Select ONCE and reuse the same node for execution + feedback attribution
    let selection: CurationTemplateSelection | null = null

    if (this.harnessService) {
      try {
        selection = await this.harnessService.selectTemplate()
      } catch {
        // Fail-open: template selection errors never block curation
      }
    }

    // --- Phase 3: Curation (session created AFTER preprocessing + compaction) ---
    let taskSessionId = await agent.createTaskSession(taskId, 'curate', {mapRootEligible: true})
    let maintenanceCompleted = false
    try {
      const {prompt} = this.buildCurationPrompt(taskId, effectiveContext, compactionResult, agent, taskSessionId)

      let response: string
      let curateOps: CurateLogOperation[] = []
      let usedTemplateFastPath = false
      let fastPathCompletedCleanly = true
      let fastPathTerminalReason = 'stop'

      if (selection?.mode === 'fast') {
        try {
          // Fast path: template-guided execution with reduced iterations
          const result = await this.executeFastPath(agent, selection.node, prompt, taskSessionId, taskId)
          response = result.response
          curateOps = result.curateOps
          usedTemplateFastPath = result.usedTemplate
          fastPathCompletedCleanly = result.completedCleanly
          fastPathTerminalReason = result.terminalReason
        } catch (error) {
          if (!(error instanceof FastPathFallbackError)) {
            throw error
          }

          // Record negative feedback (awaited so counters persist before fallback runs)
          // then trigger async refinement for the pre-mutation fallback.
          if (this.harnessService) {
            await this.harnessService.recordExecutionFailure(
              selection.node.id, [], error.terminalReason,
            ).catch(() => {})
            this.harnessService.refineIfNeeded(selection.node.id).catch(() => {})
          }

          // Start the fallback from a fresh task session. Use a unique suffix
          // to guarantee a distinct session ID — deleteTaskSession may silently
          // fail and the deterministic id `task-curate-${taskId}` would hand
          // back the cached (dirty) session from SessionManager.
          await agent.deleteTaskSession(taskSessionId).catch(() => {})
          const fallbackTaskId = `${taskId}-fallback`
          taskSessionId = await agent.createTaskSession(fallbackTaskId, 'curate', {mapRootEligible: true})
          const fallbackPrompt = this.buildCurationPrompt(
            taskId,
            effectiveContext,
            compactionResult,
            agent,
            taskSessionId,
          )
          const genResponse = await agent.generate(fallbackPrompt.prompt, {
            executionContext: {clearHistory: true, commandType: 'curate', maxIterations: 50},
            sessionId: taskSessionId,
            taskId,
          })
          response = genResponse.content
          curateOps = extractOperationsFromResponse(genResponse)
        }
      } else {
        // Normal path (shadow mode or no harness): full agent loop.
        // Use stream() so we can extract tool results even when the run
        // ends in a fatal error — generate() throws before returning
        // toolCalls, which would lose shadow feedback entirely.
        // Note: all events are buffered in memory. For very long runs this is a
        // known trade-off — we need the full event list for tool-result extraction.
        const events: StreamingEvent[] = []
        for await (const event of await agent.stream(prompt, {
          executionContext: {clearHistory: true, commandType: 'curate', maxIterations: 50},
          sessionId: taskSessionId,
          taskId,
        })) {
          events.push(event)
        }

        const responseEvent = [...events].reverse().find(
          (e): e is Extract<StreamingEvent, {name: 'llmservice:response'}> => e.name === 'llmservice:response',
        )
        const fatalErrorEvent = events.find(
          (e): e is Extract<StreamingEvent, {name: 'llmservice:error'}> =>
            e.name === 'llmservice:error' && e.recoverable !== true,
        )
        const toolResultEvents = events.filter(
          (e): e is Extract<StreamingEvent, {name: 'llmservice:toolResult'}> => e.name === 'llmservice:toolResult',
        )

        curateOps = this.extractOperationsFromToolResults(toolResultEvents)
        response = responseEvent?.content ?? ''

        if (fatalErrorEvent && !responseEvent) {
          // Record shadow feedback before re-throwing — the plan requires
          // sub-threshold templates to learn from exactly these failed rollouts.
          if (selection?.mode === 'shadow' && this.harnessService) {
            await this.recordHarnessFeedback(
              selection, curateOps, effectiveContext,
              false, false, 'error',
            ).catch(() => {})
          }

          throw new Error(fatalErrorEvent.error)
        }
      }

      // --- Feedback recording (after execution, before maintenance) ---
      if (selection && this.harnessService) {
        await this.recordHarnessFeedback(
          selection,
          curateOps,
          effectiveContext,
          usedTemplateFastPath,
          fastPathCompletedCleanly,
          fastPathTerminalReason,
        )
      }

      // --- Status tracking (use extracted ops when available, fall back to response parsing) ---
      this.lastStatus = curateOps.length > 0
        ? this.buildStatusFromOps(taskId, curateOps)
        : this.parseCurationStatus(taskId, response)

      // --- Phase 4: Post-curation maintenance (SHARED — runs for both paths) ---
      await postTreeMutationMaintenance(preState, agent, baseDir)
      maintenanceCompleted = true

      return response
    } catch (error) {
      if (selection?.mode === 'fast' && this.harnessService && error instanceof FastPathExecutionError) {
        await this.harnessService.recordExecutionFailure(
          selection.node.id,
          error.curateOps,
          error.terminalReason,
        ).catch(() => {})
        this.harnessService.refineIfNeeded(selection.node.id).catch(() => {})
      }

      if (!maintenanceCompleted) {
        await postTreeMutationMaintenance(preState, agent, baseDir)
      }

      throw error
    } finally {
      // Clean up entire task session (sandbox + history) in one call
      await agent.deleteTaskSession(taskSessionId)
    }
  }

  /**
   * Build the curation guidance prompt and inject sandbox variables.
   */
  private buildCurationPrompt(
    taskId: string,
    effectiveContext: string,
    compactionResult: {context: string; originalCharCount?: number; preCompacted?: boolean; preCompactionTier?: string},
    agent: ICipherAgent,
    taskSessionId: string,
  ): {metadata: Record<string, unknown>; prompt: string} {
    // Task-scoped variable names for RLM pattern.
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

    return {metadata, prompt}
  }

  /**
   * Build CurationStatus from extracted CurateLogOperation[].
   * More reliable than parsing JSON from response text.
   */
  private buildStatusFromOps(taskId: string, ops: CurateLogOperation[]): CurationStatus {
    const summary = computeSummary(ops)
    const successes = summary.added + summary.deleted + summary.merged + summary.updated

    let status: 'failed' | 'partial' | 'success'
    if (summary.failed > 0 && successes === 0) {
      status = 'failed'
    } else if (summary.failed > 0) {
      status = 'partial'
    } else {
      status = 'success'
    }

    return {
      completedAt: new Date().toISOString(),
      status,
      summary,
      taskId,
      verification: {checked: 0, confirmed: 0, missing: []},
    }
  }

  /**
   * Fast path: execute with template guidance.
   *
   * Errors propagate to the caller instead of retrying with a fresh full-agent
   * run. Curate mutations are not transactional, so replaying after a late
   * failure can duplicate or compound filesystem changes.
   * Uses the SAME node for both execution and feedback (no double selection).
   */
  private async executeFastPath(
    agent: ICipherAgent,
    templateNode: HarnessNode,
    prompt: string,
    taskSessionId: string,
    taskId: string,
  ): Promise<{
    completedCleanly: boolean
    curateOps: CurateLogOperation[]
    response: string
    terminalReason: string
    usedTemplate: boolean
  }> {
    const events: StreamingEvent[] = []
    const stream = await agent.stream(
      buildTemplatePrompt(templateNode, prompt),
      buildTemplateStreamOptions(taskSessionId, taskId),
    )

    for await (const event of stream) {
      events.push(event)
    }

    const responseEvent = [...events].reverse().find(
      (event): event is Extract<StreamingEvent, {name: 'llmservice:response'}> => event.name === 'llmservice:response',
    )
    const completionEvent = [...events].reverse().find(
      (event): event is Extract<StreamingEvent, {name: 'run:complete'}> => event.name === 'run:complete',
    )
    const fatalErrorEvent = [...events].reverse().find(
      (event): event is Extract<StreamingEvent, {name: 'llmservice:error'}> =>
        event.name === 'llmservice:error' && event.recoverable !== true,
    )
    const toolCallEvents = events.filter(
      (event): event is Extract<StreamingEvent, {name: 'llmservice:toolCall'}> => event.name === 'llmservice:toolCall',
    )
    const toolResultEvents = events.filter(
      (event): event is Extract<StreamingEvent, {name: 'llmservice:toolResult'}> => event.name === 'llmservice:toolResult',
    )
    const terminalReason = completionEvent?.finishReason ?? (fatalErrorEvent ? 'error' : 'stop')
    const completedCleanly =
      Boolean(responseEvent)
      && responseEvent?.partial !== true
      && !fatalErrorEvent
      && terminalReason === 'stop'

    // Extract curate operations from tool results for feedback/partial results.
    // Mutation detection is handled separately via durable tool-result metadata
    // plus direct curate tool calls so truncation or parse failures do not
    // incorrectly classify a mutating fast-path run as safe to replay.
    const curateOps = this.extractOperationsFromToolResults(toolResultEvents)
    const hasMutationSignal =
      curateOps.length > 0
      || toolCallEvents.some((event) => event.toolName === 'curate')
      || toolResultEvents.some((event) => this.hasMutationSignal(event))

    if (completedCleanly && responseEvent) {
      return {
        completedCleanly: true,
        curateOps,
        response: responseEvent.content,
        terminalReason,
        usedTemplate: true,
      }
    }

    if (completionEvent?.finishReason === 'cancelled') {
      throw new SessionCancelledError(taskSessionId)
    }

    if (!hasMutationSignal) {
      throw new FastPathFallbackError(terminalReason)
    }

    if (responseEvent) {
      return {
        completedCleanly: false,
        curateOps,
        response: responseEvent.content,
        terminalReason,
        usedTemplate: true,
      }
    }

    const message = fatalErrorEvent?.error ?? 'Template execution failed after starting mutate-capable tools'
    throw new FastPathExecutionError(message, curateOps, terminalReason)
  }

  private extractOperationsFromToolResults(
    toolResultEvents: Array<Extract<StreamingEvent, {name: 'llmservice:toolResult'}>>,
  ): CurateLogOperation[] {
    const operations: CurateLogOperation[] = []

    for (const event of toolResultEvents) {
      if (!event.result || (event.toolName !== 'curate' && event.toolName !== 'code_exec')) continue
      operations.push(...extractCurateOperations({result: event.result, toolName: event.toolName}))
    }

    return operations
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

  private hasMutationSignal(
    event: Extract<StreamingEvent, {name: 'llmservice:toolResult'}>,
  ): boolean {
    if (event.toolName === 'curate') return true

    const {metadata} = event
    if (!metadata || typeof metadata !== 'object') return false

    const attempted = metadata.knowledgeMutationAttempted
    if (attempted === true) return true

    const {curateResultsCount} = metadata
    return typeof curateResultsCount === 'number' && curateResultsCount > 0
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
   * Record harness feedback after execution completes.
   *
   * - Fast mode: binary pass/fail from operations
   * - Shadow mode: F1-scored predictions vs actuals
   *
   * Feedback is recorded FIRST, then refinement is triggered sequentially
   * (so shouldRefine() sees the updated counters/buffers).
   */
  private async recordHarnessFeedback(
    selection: CurationTemplateSelection,
    curateOps: CurateLogOperation[],
    effectiveContext: string,
    usedTemplateFastPath: boolean,
    fastPathCompletedCleanly: boolean,
    fastPathTerminalReason: string,
  ): Promise<void> {
    if (!this.harnessService) return
    if (selection.mode === 'fast' && !usedTemplateFastPath) return

    if (selection.mode === 'fast') {
      await (
        fastPathCompletedCleanly
          ? this.harnessService.recordFeedback(selection.node.id, curateOps)
          : this.harnessService.recordExecutionFailure(selection.node.id, curateOps, fastPathTerminalReason)
      )
    } else {
      await this.harnessService.recordShadowFeedback(selection.node, effectiveContext, curateOps)
    }

    // Refinement is non-blocking — kick off after feedback persists but do not
    // await it. The critic/refiner LLM calls can take seconds and must not
    // block the curate response path.
    this.harnessService.refineIfNeeded(selection.node.id).catch(() => {})
  }
}
