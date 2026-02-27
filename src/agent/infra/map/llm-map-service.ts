import {randomUUID} from 'node:crypto'
import {writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'

import type {
  GenerateContentResponse,
  IContentGenerator,
} from '../../core/interfaces/i-content-generator.js'
import type {MapRunResult} from './worker-pool.js'

import {
  buildRetryMessage,
  buildUserMessage,
  LLM_MAP_SYSTEM_MESSAGE,
  parseJsonlFile,
  validateAgainstSchema,
  type LlmMapParameters,
} from './map-shared.js'
import {runMapWorkerPool, type MapProgress} from './worker-pool.js'

// ── Types ────────────────────────────────────────────────────────────────────

export interface LlmMapServiceOptions {
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal
  /** Content generator (LLM backend) for making stateless calls */
  generator: IContentGenerator
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
    model: modelParam,
    output_path: outputPath,
    output_schema: outputSchema,
    prompt,
  } = params

  // Resolve paths relative to working directory (project root)
  const resolvedInputPath = resolve(workingDirectory, inputPath)
  const resolvedOutputPath = resolve(workingDirectory, outputPath)

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

    let attemptsUsed = 1
    let lastResponse = ''
    let lastError = ''

    // Initial LLM call (stateless — no tool access)
    const response = await callLlm(generator, userMessage, modelParam, taskId, abortSignal)
    lastResponse = response.content

    // Validation loop with retry
    while (true) {
      // Try to parse JSON
      let parsed: unknown
      try {
        parsed = JSON.parse(lastResponse)
      } catch (e) {
        lastError = `JSON parse error: ${e instanceof Error ? e.message : String(e)}`
      }

      // Validate against schema
      if (parsed !== undefined) {
        const validation = validateAgainstSchema(parsed, outputSchema)
        if (validation.valid) {
          return parsed
        }

        lastError = `Schema validation failed: ${validation.error}`
      }

      // Check retry budget
      if (attemptsUsed >= maxAttempts) {
        throw new Error(`Failed after ${attemptsUsed} attempts. Last error: ${lastError}`)
      }

      // Check abort
      if (abortSignal?.aborted) {
        throw new Error('Aborted')
      }

      // Retry with error context + prior response
      attemptsUsed++
      const retryMessage = buildRetryMessage(userMessage, lastError, lastResponse)
      const retryResponse = await callLlm(generator, retryMessage, modelParam, taskId, abortSignal)
      lastResponse = retryResponse.content
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

  // 5. Write output JSONL from in-memory results (sorted by index)
  const sorted = [...result.results.entries()].sort(([a], [b]) => a - b)
  const outputContent = sorted.map(([, r]) => JSON.stringify(r)).join('\n')
  await writeFile(resolvedOutputPath, outputContent, 'utf8')

  return result
}

// ── Internal Helpers ─────────────────────────────────────────────────────────

async function callLlm(
  generator: IContentGenerator,
  userMessage: string,
  model?: string,
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
    model: model ?? 'default',
    systemPrompt: LLM_MAP_SYSTEM_MESSAGE,
    taskId: taskId ?? randomUUID(),
  })
}
