import {randomUUID} from 'node:crypto'
import {writeFile} from 'node:fs/promises'

import type {ICipherAgent} from '../../core/interfaces/i-cipher-agent.js'
import type {ILogger} from '../../core/interfaces/i-logger.js'
import type {ContextTreeStore} from './context-tree-store.js'

import {
  type AgenticMapParameters,
  buildRecursiveCompositionGuidance,
  buildUserMessage,
  canonicalizePath,
  parseJsonlFile,
  resolveAndValidatePath,
  validateAgainstSchema,
  withTimeout,
} from './map-shared.js'
import {type MapProgress, type MapRunResult, runMapWorkerPool} from './worker-pool.js'

// ── Constants ────────────────────────────────────────────────────────────────

/** Absolute depth ceiling — cannot be exceeded regardless of LLM-supplied max_depth */
export const HARD_MAX_DEPTH = 3

/** Max parallel sub-agent sessions (lower than VoltCode's 16 for CLI machines) */
const DEFAULT_CONCURRENCY = 4

// ── Nesting Registry ─────────────────────────────────────────────────────────

interface NestingRecord {
  absoluteMaxDepth: number
  ancestorInputPaths: ReadonlySet<string>
  isRootCaller: boolean
  mapRunId: string
  nestingDepth: number
  /** Agent instance that registered this root-eligible session (undefined for sub-sessions) */
  ownerId?: string
}

const nestingRegistry = new Map<string, NestingRecord>()
const runSessionIndex = new Map<string, Set<string>>()

/** Read-only accessor — raw map is not exported */
export function getNestingRecord(sessionId: string): Readonly<NestingRecord> | undefined {
  return nestingRegistry.get(sessionId)
}

/**
 * Register a session as root-eligible for write-enabled agentic_map calls.
 * Must be called at session creation time (e.g., CipherAgent.start/createSession).
 * Idempotent for already-registered root callers with the same ownerId.
 * Throws if the session is already registered as a sub-session (isRootCaller: false) —
 * this indicates a bug (task-session ID passed to a root-eligible creation path).
 * Throws if the session is already registered to a DIFFERENT ownerId — this
 * indicates a cross-agent session ID collision and must fail fast.
 *
 * @param sessionId - Session to register
 * @param ownerId - Unique identifier for the agent instance that owns this registration.
 *   Used to scope deregistration: only the owning agent can remove the record.
 */
export function registerRootEligibleSession(sessionId: string, ownerId: string): void {
  const existing = nestingRegistry.get(sessionId)
  if (existing !== undefined) {
    if (!existing.isRootCaller) {
      throw new Error(
        `registerRootEligibleSession: session "${sessionId}" is already registered as a ` +
        `sub-session. Cannot promote to root-eligible. This is a bug.`,
      )
    }

    if (existing.ownerId !== ownerId) {
      throw new Error(
        `registerRootEligibleSession: session "${sessionId}" is already owned by a different ` +
        `agent instance. Refusing to share root-eligible registration across owners.`,
      )
    }

    return // already root-eligible for same owner — idempotent no-op
  }

  nestingRegistry.set(sessionId, {
    absoluteMaxDepth: 0, // not used for root callers
    ancestorInputPaths: new Set(),
    isRootCaller: true,
    mapRunId: '', // not used; re-derived per invocation
    nestingDepth: 0,
    ownerId,
  })
}

/**
 * Remove a root-eligible session registration.
 * Call when a session registered via registerRootEligibleSession() is deleted.
 * Only deletes if the record's ownerId matches the caller — prevents one agent
 * instance from removing another agent's live record.
 * Safe to call for unregistered sessions (no-op).
 *
 * @param sessionId - Session to deregister
 * @param ownerId - Must match the ownerId used at registration time
 */
export function deregisterRootEligibleSession(sessionId: string, ownerId: string): void {
  const record = nestingRegistry.get(sessionId)
  if (record?.isRootCaller && record.ownerId === ownerId) {
    nestingRegistry.delete(sessionId)
  }
}

/** FOR TEST USE ONLY — do not call in production code */
export function _resetNestingRegistryForTests(): void {
  nestingRegistry.clear()
  runSessionIndex.clear()
}

/** FOR TEST USE ONLY — inject a sub-session record into the nesting registry */
export function _setNestingRecordForTests(sessionId: string, record: {
  absoluteMaxDepth: number
  ancestorInputPaths: ReadonlySet<string>
  isRootCaller: boolean
  mapRunId: string
  nestingDepth: number
}): void {
  nestingRegistry.set(sessionId, record)
}

/** FOR TEST USE ONLY — inject entries into the runSessionIndex */
export function _setRunSessionIndexForTests(mapRunId: string, sessionIds: Set<string>): void {
  runSessionIndex.set(mapRunId, sessionIds)
}

/** FOR TEST USE ONLY — expose cleanupMapRun for registry lifecycle tests */
export function _cleanupMapRunForTests(mapRunId: string): void {
  cleanupMapRun(mapRunId)
}

/** Bulk cleanup for a completed root run. Called ONLY at nestingDepth === 0. */
function cleanupMapRun(mapRunId: string): void {
  const sids = runSessionIndex.get(mapRunId)
  if (sids) {
    for (const sid of sids) {
      nestingRegistry.delete(sid) // all entries here are isRootCaller: false
    }

    runSessionIndex.delete(mapRunId)
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface AgenticMapServiceOptions {
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal
  /** The cipher agent instance for creating sub-sessions */
  agent: ICipherAgent
  /** Internal: canonical input paths of all ancestor calls (anti-cycle) */
  ancestorInputPaths?: ReadonlySet<string>
  /** Optional context tree store for result aggregation */
  contextTreeStore?: ContextTreeStore
  /** Internal: root's clamped max depth, inherited by descendants */
  effectiveMaxDepth?: number
  /** Optional logger for fail-open warnings */
  logger?: ILogger
  /** Internal: root run ID for bulk sub-session cleanup */
  mapRunId?: string
  /** Internal: nesting depth of this call (0 = root) */
  nestingDepth?: number
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

  // Destructure internal nesting options
  const nestingDepth = options.nestingDepth ?? 0
  // Always clamp to HARD_MAX_DEPTH — defense-in-depth even if caller supplies a higher value
  const effectiveMaxDepth = Math.min(options.effectiveMaxDepth ?? Math.min(params.max_depth ?? 1, HARD_MAX_DEPTH), HARD_MAX_DEPTH)
  const ancestorInputPaths = options.ancestorInputPaths ?? new Set<string>()
  const mapRunId = options.mapRunId ?? randomUUID()

  // Resolve paths relative to working directory and validate they don't escape it
  const resolvedInputPath = resolveAndValidatePath(workingDirectory, inputPath)
  const resolvedOutputPath = resolveAndValidatePath(workingDirectory, outputPath)
  const canonicalInputPath = canonicalizePath(resolvedInputPath)

  // Anti-cycle — unconditional (defense-in-depth regardless of read_only and allowlist state)
  if (ancestorInputPaths.has(canonicalInputPath)) {
    throw new Error(
      `agentic_map: cycle — input_path "${inputPath}" is already being processed ` +
      `by an ancestor call. Use a distinct JSONL file at each nesting level.`,
    )
  }

  // Depth — unconditional
  if (nestingDepth >= effectiveMaxDepth) {
    throw new Error(
      `agentic_map: nesting depth ${nestingDepth} has reached max_depth ${effectiveMaxDepth} ` +
      `(hard ceiling: ${HARD_MAX_DEPTH}).`,
    )
  }

  // Depth-aware concurrency
  const concurrency = Math.max(1, Math.floor(DEFAULT_CONCURRENCY / (nestingDepth + 1)))

  // Always include current input path in child ancestor set (covers read_only branches too)
  const childAncestorPaths = new Set([canonicalInputPath, ...ancestorInputPaths])

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
      // When read_only, use 'query' command type to restrict sub-agent to read-only tools
      const itemTaskId = `map-item-${itemIndex}-${randomUUID().slice(0, 8)}`
      const sessionCommandType = readOnly ? 'query' : 'curate'
      // mapRootEligible intentionally omitted — sub-sessions are NOT root-eligible.
      // The isRootCaller: false record is set directly below.
      const sessionId = await agent.createTaskSession(itemTaskId, sessionCommandType)
      sessionIds.push(sessionId)

      // Register ALL sub-sessions for depth tracking (defense against future allowlist changes)
      nestingRegistry.set(sessionId, {
        absoluteMaxDepth: effectiveMaxDepth,
        ancestorInputPaths: childAncestorPaths,
        isRootCaller: false,
        mapRunId,
        nestingDepth: nestingDepth + 1,
      })
      if (!runSessionIndex.has(mapRunId)) runSessionIndex.set(mapRunId, new Set())
      runSessionIndex.get(mapRunId)!.add(sessionId)

      // Build user message
      let userMessageText = buildUserMessage(
        prompt,
        'pending',
        runStartedAt,
        itemIndex,
        item,
        outputSchema,
      )

      // Append guidance when further nesting is possible (write-enabled only)
      const canNest = !readOnly && (nestingDepth + 1) < effectiveMaxDepth
      if (canNest) {
        userMessageText += '\n\n' + buildRecursiveCompositionGuidance(nestingDepth + 1, effectiveMaxDepth)
      }

      // Per-item timeout
      const timeoutController = new AbortController()
      const timeoutHandle = setTimeout(() => {
        timeoutController.abort()
      }, timeoutSeconds * 1000)

      try {
        let attemptsUsed = 1

        // Full agentic prompt (with tool access, multi-step reasoning)
        let result = await withTimeout(
          agent.executeOnSession(sessionId, userMessageText, {
            executionContext: {
              clearHistory: true,
              commandType: sessionCommandType,
              maxIterations: readOnly ? 10 : 20,
            },
            taskId: taskId ?? randomUUID(),
          }),
          timeoutController.signal,
        )

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
              } catch (error) {
                lastError = `JSON parse error from code block: ${error instanceof Error ? error.message : String(error)}`
              }
            } else {
              // Try to find JSON object/array in the response
              const jsonObjMatch = result.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
              if (jsonObjMatch) {
                try {
                  parsed = JSON.parse(jsonObjMatch[1])
                } catch (error) {
                  lastError = `JSON parse error from extraction: ${error instanceof Error ? error.message : String(error)}`
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

          // eslint-disable-next-line no-await-in-loop
          result = await withTimeout(
            agent.executeOnSession(sessionId, retryPrompt, {
              executionContext: {commandType: sessionCommandType, maxIterations: 5},
              taskId: taskId ?? randomUUID(),
            }),
            timeoutController.signal,
          )
        }
      } finally {
        clearTimeout(timeoutHandle)

        // Do NOT delete sessions or registry here.
        // Session deletion is handled by the outer finally (Promise.allSettled)
        // to avoid a double-dispose race with concurrent deleteTaskSession calls.
        // Registry cleanup is done exclusively by cleanupMapRun at root,
        // ensuring orphaned sessions (withTimeout race) retain their depth records
        // until the root run has fully completed.
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
  } finally {
    // Await all session deletions before cleaning registry.
    // Reduces the race window where orphaned sessions could call agentic_map
    // after their records are wiped.
    await Promise.allSettled(sessionIds.map((sid) => agent.deleteTaskSession(sid)))

    // Bulk cleanup only at root — nested levels must NOT call this,
    // as it would wipe sibling sessions still running at the same depth.
    if (nestingDepth === 0) {
      cleanupMapRun(mapRunId)
    }
  }
}

