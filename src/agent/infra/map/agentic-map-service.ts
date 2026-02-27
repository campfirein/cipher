import {randomUUID} from 'node:crypto'
import {writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'

import type {ICipherAgent} from '../../core/interfaces/i-cipher-agent.js'
import type {MapRunResult} from './worker-pool.js'

import {
  buildUserMessage,
  parseJsonlFile,
  validateAgainstSchema,
  type AgenticMapParameters,
} from './map-shared.js'
import {runMapWorkerPool, type MapProgress} from './worker-pool.js'

// ── Constants ────────────────────────────────────────────────────────────────

/** Max parallel sub-agent sessions (lower than VoltCode's 16 for CLI machines) */
const DEFAULT_CONCURRENCY = 4

// ── Types ────────────────────────────────────────────────────────────────────

export interface AgenticMapServiceOptions {
  /** The cipher agent instance for creating sub-sessions */
  agent: ICipherAgent
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal
  /** Progress callback */
  onProgress?: (progress: MapProgress) => void
  /** Tool parameters from the LLM */
  params: AgenticMapParameters
  /** Task ID for event routing */
  taskId?: string
  /** Working directory (project root) */
  workingDirectory: string
}

// ── Agentic-Map Service ──────────────────────────────────────────────────────

/**
 * Execute an Agentic-Map: parallel sub-agent sessions over a JSONL file.
 *
 * For each item (line), spawns a full agent session with tool access.
 * The sub-agent must output a JSON value that validates against the provided
 * output schema.
 *
 * Ported from VoltCode's agentic-map.ts, adapted for byterover-cli:
 * - Uses agent.createTaskSession() / agent.executeOnSession() instead of Session.create()
 * - Uses in-memory worker pool (no FileMapStore / PostgreSQL)
 * - Concurrency capped at 4 (CLI runs on user machines)
 */
export async function executeAgenticMap(options: AgenticMapServiceOptions): Promise<MapRunResult> {
  const {
    abortSignal,
    agent,
    onProgress,
    params,
    taskId,
    workingDirectory,
  } = options

  const {
    input_path: inputPath,
    max_attempts: maxAttempts = 3,
    output_path: outputPath,
    output_schema: outputSchema,
    prompt,
    read_only: readOnly = true,
    timeout_seconds: timeoutSeconds = 300,
  } = params

  const concurrency = DEFAULT_CONCURRENCY

  // Resolve paths relative to working directory (project root)
  const resolvedInputPath = resolve(workingDirectory, inputPath)
  const resolvedOutputPath = resolve(workingDirectory, outputPath)

  // 1. Parse input JSONL
  const items = await parseJsonlFile(resolvedInputPath)
  if (items.length === 0) {
    await writeFile(resolvedOutputPath, '', 'utf8')

    return {failed: 0, mapId: 'empty', succeeded: 0, total: 0}
  }

  // 2. Prepare run metadata
  const runStartedAt = new Date().toISOString()

  // Track created sessions for cleanup
  const sessionIds: string[] = []

  try {
    // 3. Define per-item processing function
    async function processItem(itemIndex: number, item: unknown): Promise<unknown> {
      // Create a per-item task session
      const itemTaskId = `map-item-${itemIndex}-${randomUUID().slice(0, 8)}`
      const sessionId = await agent.createTaskSession(itemTaskId, 'curate')
      sessionIds.push(sessionId)

      const userMessageText = buildUserMessage(
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

        // Full agentic prompt (with tool access, multi-step reasoning)
        let result = await agent.executeOnSession(sessionId, userMessageText, {
          executionContext: {
            clearHistory: true,
            commandType: 'curate',
            maxIterations: readOnly ? 10 : 20,
          },
          taskId: taskId ?? randomUUID(),
        })

        // Validation loop with retry
        while (true) {
          // Extract JSON from the response
          let parsed: unknown
          let lastError = ''

          // Try to parse the entire response as JSON first
          try {
            parsed = JSON.parse(result)
          } catch {
            // Try to extract JSON block from response
            const jsonMatch = result.match(/```json\s*\n([\s\S]*?)\n```/)
            if (jsonMatch) {
              try {
                parsed = JSON.parse(jsonMatch[1])
              } catch (e) {
                lastError = `JSON parse error from code block: ${e instanceof Error ? e.message : String(e)}`
              }
            } else {
              // Try to find JSON object/array in the response
              const jsonObjMatch = result.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
              if (jsonObjMatch) {
                try {
                  parsed = JSON.parse(jsonObjMatch[1])
                } catch (e) {
                  lastError = `JSON parse error from extraction: ${e instanceof Error ? e.message : String(e)}`
                }
              } else {
                lastError = 'No JSON found in response'
              }
            }
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
          if (abortSignal?.aborted || timeoutController.signal.aborted) {
            throw new Error('Aborted or timed out')
          }

          // Retry by sending validation error back to the SAME session
          attemptsUsed++
          const retryPrompt = [
            `Validation failed: ${lastError}`,
            '',
            'Respond with corrected JSON only. No explanations, no markdown fences.',
          ].join('\n')

          result = await agent.executeOnSession(sessionId, retryPrompt, {
            executionContext: {commandType: 'curate', maxIterations: 5},
            taskId: taskId ?? randomUUID(),
          })
        }
      } finally {
        clearTimeout(timeoutHandle)

        // Cleanup session (best-effort)
        agent.deleteTaskSession(sessionId).catch(() => {})
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
  } finally {
    // Cleanup any remaining sessions
    for (const sid of sessionIds) {
      agent.deleteTaskSession(sid).catch(() => {})
    }
  }
}
