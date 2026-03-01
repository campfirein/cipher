import {randomUUID} from 'node:crypto'
import {writeFile} from 'node:fs/promises'

import type {
  GenerateContentResponse,
  IContentGenerator,
} from '../../core/interfaces/i-content-generator.js'
import type {ILogger} from '../../core/interfaces/i-logger.js'
import type {ContextTreeStore} from './context-tree-store.js'

import {
  buildRetryMessage,
  buildUserMessage,
  LLM_MAP_SYSTEM_MESSAGE,
  type LlmMapParameters,
  parseJsonlFile,
  resolveAndValidatePath,
  validateAgainstSchema,
} from './map-shared.js'
import {type MapProgress, type MapRunResult, runMapWorkerPool} from './worker-pool.js'

// ── Types ────────────────────────────────────────────────────────────────────

export interface LlmMapServiceOptions {
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal
  /** Optional context tree store for result aggregation */
  contextTreeStore?: ContextTreeStore
  /** Content generator (LLM backend) for making stateless calls */
  generator: IContentGenerator
  /** Optional logger for fail-open warnings */
  logger?: ILogger
  /** Progress callback */
  onProgress?: (progress: MapProgress) => void
  /** Tool parameters from the LLM */
  params: LlmMapParameters
  /** Task ID for billing tracking */
  taskId?: string
  /** Working directory (project root) */
  workingDirectory: string
}

// ── LLM-Map Service ──────────────────────────────────────────────────────────

/**
 * Execute an LLM-Map: parallel, stateless LLM calls over a JSONL file.
 *
 * For each item (line), makes a single LLM API call (no tools, no file I/O)
 * that must return one JSON value conforming to the provided output schema.
 * If validation fails, the system retries with the error and prior response.
 *
 * Ported from VoltCode's llm-map.ts, adapted for byterover-cli:
 * - Uses IContentGenerator instead of AI SDK's generateText()
 * - Uses in-memory worker pool (no FileMapStore / PostgreSQL)
 * - Runs in-process (no SQS)
 */
export async function executeLlmMap(options: LlmMapServiceOptions): Promise<MapRunResult> {
  const {
    abortSignal,
    generator,
    onProgress,
    params,
    taskId,
    workingDirectory,
  } = options

  const {
    concurrency = 8,
    input_path: inputPath,
    max_attempts: maxAttempts = 3,
    output_path: outputPath,
    output_schema: outputSchema,
    prompt,
    timeout_seconds: timeoutSeconds = 120,
  } = params

  // Resolve paths relative to working directory and validate they don't escape it
  const resolvedInputPath = resolveAndValidatePath(workingDirectory, inputPath)
  const resolvedOutputPath = resolveAndValidatePath(workingDirectory, outputPath)

  // 1. Parse input JSONL
  const items = await parseJsonlFile(resolvedInputPath)
  if (items.length === 0) {
    // Write empty output file
    await writeFile(resolvedOutputPath, '', 'utf8')

    return {failed: 0, mapId: 'empty', succeeded: 0, total: 0}
  }

  // 2. Prepare run metadata
  const runStartedAt = new Date().toISOString()

  // 3. Define per-item processing function
  async function processItem(itemIndex: number, item: unknown): Promise<unknown> {
    const userMessage = buildUserMessage(
      prompt,
      'pending',
      runStartedAt,
      itemIndex,
      item,
      outputSchema,
    )

    // Per-item timeout
    const timeoutController = new AbortController()
    const timeoutHandle = setTimeout(() => {
      timeoutController.abort()
    }, timeoutSeconds * 1000)

    try {
      let attemptsUsed = 1
      let lastResponse = ''
      let lastError = ''

      // Initial LLM call (stateless — no tool access)
      // Wrap with timeout so a hung generateContent() doesn't block forever
      const response = await withTimeout(
        callLlm(generator, userMessage, taskId, abortSignal),
        timeoutController.signal,
      )
      lastResponse = response.content

      // Validation loop with retry
      while (true) {
        // Try to parse JSON
        let parsed: unknown
        try {
          parsed = JSON.parse(lastResponse)
        } catch (error) {
          lastError = `JSON parse error: ${error instanceof Error ? error.message : String(error)}`
        }

        // Validate against schema
        if (parsed !== undefined) {
          const validation = validateAgainstSchema(parsed, outputSchema)
          if (validation.valid) {
            // Fail-open: store result in context tree if available
            if (options.contextTreeStore) {
              try {
                options.contextTreeStore.store(itemIndex, JSON.stringify(parsed))
              } catch (storeError) {
                options.logger?.warn('Context tree store failed', {error: String(storeError), itemIndex})
              }
            }

            return parsed
          }

          lastError = `Schema validation failed: ${validation.error}`
        }

        // Check retry budget
        if (attemptsUsed >= maxAttempts) {
          throw new Error(`Failed after ${attemptsUsed} attempts. Last error: ${lastError}`)
        }

        // Check abort or timeout
        if (abortSignal?.aborted || timeoutController.signal.aborted) {
          throw new Error('Aborted or timed out')
        }

        // Retry with error context + prior response
        attemptsUsed++
        const retryMessage = buildRetryMessage(userMessage, lastError, lastResponse)
        // eslint-disable-next-line no-await-in-loop
        const retryResponse = await withTimeout(
          callLlm(generator, retryMessage, taskId, abortSignal),
          timeoutController.signal,
        )
        lastResponse = retryResponse.content
      }
    } finally {
      clearTimeout(timeoutHandle)
    }
  }

  // 4. Run in-memory worker pool
  const result = await runMapWorkerPool({
    abortSignal,
    concurrency,
    items,
    onProgress,
    processItem,
  })

  // 5. Compact context tree and attach summaryHandle (fail-open)
  if (options.contextTreeStore) {
    try {
      await options.contextTreeStore.compact()
      result.summaryHandle = options.contextTreeStore.getSummaryHandle()
    } catch (compactError) {
      options.logger?.warn('Context tree compaction failed', {error: String(compactError)})
    }
  }

  // 6. Write output JSONL from in-memory results (sorted by index)
  const sorted = [...result.results.entries()].sort(([a], [b]) => a - b)
  const outputContent = sorted.map(([, r]) => JSON.stringify(r)).join('\n')
  await writeFile(resolvedOutputPath, outputContent, 'utf8')

  return result
}

// ── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Race a promise against an abort signal.
 * Since IContentGenerator.generateContent() doesn't accept AbortSignal,
 * this ensures the per-item timeout stops waiting for a hung LLM call.
 */
function withTimeout<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new Error('Timed out'))
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new Error('Timed out'))
    }

    signal.addEventListener('abort', onAbort, {once: true})

    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

async function callLlm(
  generator: IContentGenerator,
  userMessage: string,
  taskId?: string,
  abortSignal?: AbortSignal,
): Promise<GenerateContentResponse> {
  if (abortSignal?.aborted) {
    throw new Error('Aborted')
  }

  return generator.generateContent({
    config: {
      maxTokens: 4096,
      temperature: 0,
    },
    contents: [
      {content: userMessage, role: 'user'},
    ],
    model: 'default',
    systemPrompt: LLM_MAP_SYSTEM_MESSAGE,
    taskId: taskId ?? randomUUID(),
  })
}
