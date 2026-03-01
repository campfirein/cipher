/**
 * In-Memory LLM Map — parallel, stateless LLM calls over in-memory items.
 *
 * Reuses `runMapWorkerPool` and the `callLlm`/`withTimeout` pattern from
 * `llm-map-service.ts`, but skips all JSONL file I/O.
 *
 * Designed for curation extraction: processes text chunks in parallel,
 * returns CurationFact[] per item with fixed internal validation
 * (no generic schema — curation-specific).
 */

import {randomUUID} from 'node:crypto'

import type {
  GenerateContentResponse,
  IContentGenerator,
} from '../../core/interfaces/i-content-generator.js'
import type {ILogger} from '../../core/interfaces/i-logger.js'
import type {ContextTreeStore} from './context-tree-store.js'

import {type CurationCategory, type CurationFact, VALID_CATEGORIES} from '../sandbox/curation-helpers.js'
import {
  buildRetryMessage,
  buildUserMessage,
  LLM_MAP_SYSTEM_MESSAGE,
} from './map-shared.js'
import {type MapProgress, runMapWorkerPool} from './worker-pool.js'

// ── Types ────────────────────────────────────────────────────────────────────

export interface LlmMapMemoryOptions {
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal
  /** Number of parallel workers (default: 8) */
  concurrency?: number
  /** Optional context tree store for result aggregation */
  contextTreeStore?: ContextTreeStore
  /** Content generator for stateless LLM calls */
  generator: IContentGenerator
  /** Items to process (in-memory, not from JSONL) */
  items: unknown[]
  /** Optional logger for fail-open warnings */
  logger?: ILogger
  /** Max attempts per item (default: 3) */
  maxAttempts?: number
  /** Progress callback */
  onProgress?: (progress: MapProgress) => void
  /** Prompt template for each item */
  prompt: string
  /** Task ID for billing */
  taskId?: string
  /** Timeout per item in seconds (default: 120) */
  timeoutSeconds?: number
}

export interface LlmMapMemoryResult {
  /** Number of failed items */
  failed: number
  /** Per-item results (ordered by input index). null for failed items. */
  results: (CurationFact[] | null)[]
  /** Number of succeeded items */
  succeeded: number
  /** Compact summary of processed items (from ContextTreeStore) */
  summaryHandle?: string
  /** Total items processed */
  total: number
}

// ── Fixed output schema for curation facts ───────────────────────────────────

const CURATION_FACT_SCHEMA: Record<string, unknown> = {
  items: {
    properties: {
      category: {type: 'string'},
      statement: {type: 'string'},
      subject: {type: 'string'},
    },
    required: ['statement'],
    type: 'object',
  },
  type: 'array',
}

// ── Main Function ────────────────────────────────────────────────────────────

/**
 * Execute an in-memory LLM map for curation extraction.
 *
 * Processes items in parallel using `runMapWorkerPool`. Each item gets a
 * stateless LLM call that must return CurationFact[]. Invalid categories
 * are normalized to undefined. Single-object responses are wrapped in arrays.
 */
export async function executeLlmMapMemory(options: LlmMapMemoryOptions): Promise<LlmMapMemoryResult> {
  const {
    abortSignal,
    concurrency = 8,
    generator,
    items,
    maxAttempts = 3,
    onProgress,
    prompt,
    taskId,
    timeoutSeconds = 120,
  } = options

  if (items.length === 0) {
    return {failed: 0, results: [], succeeded: 0, total: 0}
  }

  const runStartedAt = new Date().toISOString()

  async function processItem(itemIndex: number, item: unknown): Promise<CurationFact[]> {
    const userMessage = buildUserMessage(
      prompt,
      'memory',
      runStartedAt,
      itemIndex,
      item,
      CURATION_FACT_SCHEMA,
    )

    // Per-item timeout
    const timeoutController = new AbortController()
    const timeoutHandle = setTimeout(() => {
      timeoutController.abort()
    }, timeoutSeconds * 1000)

    try {
      let attemptsUsed = 1
      let lastError = ''
      let lastResponse = ''

      // Initial LLM call (stateless — no tool access)
      const response = await withTimeout(
        callLlm(generator, userMessage, taskId, abortSignal),
        timeoutController.signal,
      )
      lastResponse = response.content

      // Validation loop with retry
      while (true) {
        const validated = validateAndNormalize(lastResponse)
        if (validated.valid) {
          // Fail-open: store result in context tree if available
          if (options.contextTreeStore) {
            try {
              options.contextTreeStore.store(itemIndex, JSON.stringify(validated.facts))
            } catch (storeError) {
              options.logger?.warn('Context tree store failed', {error: String(storeError), itemIndex})
            }
          }

          return validated.facts
        }

        lastError = validated.error

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

  // Run in-memory worker pool
  const result = await runMapWorkerPool({
    abortSignal,
    concurrency,
    items,
    onProgress,
    processItem,
  })

  // Compact context tree and attach summaryHandle (fail-open)
  if (options.contextTreeStore) {
    try {
      await options.contextTreeStore.compact()
      result.summaryHandle = options.contextTreeStore.getSummaryHandle()
    } catch (compactError) {
      options.logger?.warn('Context tree compaction failed', {error: String(compactError)})
    }
  }

  // Convert Map<number, unknown> to ordered array with nulls for failures
  const ordered: (CurationFact[] | null)[] = []
  for (let i = 0; i < items.length; i++) {
    const value = result.results.get(i)
    ordered.push(value ? (value as CurationFact[]) : null)
  }

  return {
    failed: result.failed,
    results: ordered,
    succeeded: result.succeeded,
    summaryHandle: result.summaryHandle,
    total: result.total,
  }
}

// ── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Validate and normalize LLM response into CurationFact[].
 *
 * Single normalization layer:
 * - Accepts both CurationFact and CurationFact[] (wraps single objects)
 * - Validates each fact has typeof statement === 'string' && statement.trim().length > 0
 * - Normalizes invalid categories to undefined
 */
function validateAndNormalize(
  response: string,
): {error: string; facts: CurationFact[]; valid: false} | {error: string; facts: CurationFact[]; valid: true} {
  let parsed: unknown
  try {
    parsed = JSON.parse(response)
  } catch (error) {
    return {
      error: `JSON parse error: ${error instanceof Error ? error.message : String(error)}`,
      facts: [],
      valid: false,
    }
  }

  // Normalize single object to array
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && 'statement' in parsed) {
    parsed = [parsed]
  }

  if (!Array.isArray(parsed)) {
    return {
      error: 'Expected array of facts or a single fact object with "statement" field',
      facts: [],
      valid: false,
    }
  }

  const facts: CurationFact[] = []
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue
    const {category, statement, subject} = item as Record<string, unknown>
    if (typeof statement !== 'string' || statement.trim().length === 0) continue

    facts.push({
      category: normalizeCategory(category),
      statement: statement.trim(),
      subject: typeof subject === 'string' ? subject.trim() : undefined,
    })
  }

  // Empty input array [] is valid — some chunks legitimately contain no extractable facts.
  // But if the LLM returned items and ALL were malformed, that's a format error worth retrying.
  if (facts.length === 0 && parsed.length > 0) {
    return {
      error: `All ${parsed.length} items were malformed. Each fact must have a non-empty "statement" string.`,
      facts: [],
      valid: false,
    }
  }

  return {error: '', facts, valid: true}
}

/**
 * Normalize category to valid CurationCategory or undefined.
 */
function normalizeCategory(value: unknown): CurationCategory | undefined {
  if (typeof value !== 'string') return undefined
  const lower = value.toLowerCase().trim()

  return VALID_CATEGORIES.has(lower) ? (lower as CurationCategory) : undefined
}

/**
 * Race a promise against an abort signal.
 * Replicates the pattern from llm-map-service.ts.
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
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

function callLlm(
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
