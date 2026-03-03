import {randomUUID} from 'node:crypto'

import type {Tool, ToolExecutionContext, ToolMetadata} from '../../../core/domain/tools/types.js'
import type {ICipherAgent} from '../../../core/interfaces/i-cipher-agent.js'
import type {IContentGenerator} from '../../../core/interfaces/i-content-generator.js'
import type {ILogger} from '../../../core/interfaces/i-logger.js'
import type {ITokenizer} from '../../../core/interfaces/i-tokenizer.js'

import {executeAgenticMap, getNestingRecord, HARD_MAX_DEPTH} from '../../map/agentic-map-service.js'
import {ContextTreeStore} from '../../map/context-tree-store.js'
import {AgenticMapParametersSchema} from '../../map/map-shared.js'

/**
 * Create the agentic_map tool.
 *
 * Runs a parallel map over a JSONL file. For each item (line), spawns a
 * sub-agent that receives the prompt plus a standardized metadata block.
 * The sub-agent must output a JSON value that validates against the provided
 * output schema.
 *
 * Use this instead of llm_map when items need tool access (file reads,
 * code execution, knowledge search). Use llm_map when items don't need
 * tools — it's faster and cheaper.
 *
 * @param agent - The cipher agent for creating sub-sessions
 * @param workingDirectory - Project root directory
 * @param options - Optional dependencies for ContextTreeStore
 * @param options.executeAgenticMapImpl - Test seam override for executeAgenticMap
 * @param options.generator - Content generator for context compaction summaries
 * @param options.logger - Logger for fail-open warnings
 * @param options.maxContextTokens - Model context window used to size context tree threshold
 * @param options.tokenizer - Tokenizer used by ContextTreeStore
 */
export function createAgenticMapTool(
  agent: ICipherAgent,
  workingDirectory: string,
  options?: {
    /** Test seam: replaces executeAgenticMap for unit tests. Do not set in production. */
    executeAgenticMapImpl?: typeof executeAgenticMap
    generator?: IContentGenerator
    logger?: ILogger
    maxContextTokens?: number
    tokenizer?: ITokenizer
  },
): Tool {
  const _executeAgenticMap = options?.executeAgenticMapImpl ?? executeAgenticMap

  return {
    description: [
      'Run a parallel map over a JSONL file using sub-agent sessions.',
      'For each item (line), spawn a sub-agent that receives your prompt',
      'plus a standardized metadata block containing the item.',
      'The sub-agent must output a JSON value conforming to the output schema.',
      '',
      'Each sub-agent has full tool access (read files, search, code execution)',
      'unless read_only is set to true (which disables write operations).',
      '',
      'Use this tool when items need tool access during processing.',
      'Use llm_map instead if items only need LLM intelligence — it is faster and cheaper.',
      '',
      'Concurrency is capped at 4 parallel sub-agents.',
      'Input: JSONL file (one JSON object per line)',
      'Output: JSONL file with one result per line, ordered by input line.',
      '',
      'Results include an optional summaryHandle — a compact summary of processed items.',
      'The JSONL output file is always the source of truth for per-item results.',
    ].join('\n'),

    async execute(input: unknown, context?: ToolExecutionContext): Promise<unknown> {
      const params = AgenticMapParametersSchema.parse(input)

      // [Guard A] Write-enabled + missing sessionId.
      // In standard ToolManager execution this is unreachable: ToolManager always injects
      // sessionId (tool-manager.ts:159). Only reachable via direct tool invocation
      // that bypasses ToolManager (tests, headless).
      if (params.read_only === false && !context?.sessionId) {
        throw new Error(
          'agentic_map: session ID unavailable for write-enabled call. ' +
          'Cannot determine nesting depth. This is a bug — please report it.',
        )
      }

      const callerRecord = context?.sessionId ? getNestingRecord(context.sessionId) : undefined

      // [Guard B] Hard assertion: non-write-enabled call inside a write-enabled sub-session.
      // Catches both explicit read_only=true and omitted read_only (defaults to true in service).
      // Decoupled from allowlist — catches read_only recursion even if allowlist changes.
      if (params.read_only !== false && callerRecord !== undefined && !callerRecord.isRootCaller) {
        throw new Error(
          'agentic_map: read_only=false is required for recursive (nested) calls. ' +
          'Recursive composition requires read_only=false.',
        )
      }

      // [Guard C] Universal fail-closed: sessionId present but no registry record.
      // All legitimate sessions are registered at creation (CipherAgent.createSession/start/
      // getOrCreateSession/stream). An unregistered session with a known ID is either:
      //   (a) an orphaned sub-session whose record was cleaned by cleanupMapRun, or
      //   (b) a session created outside the registered paths (unexpected).
      // Both cases are rejected regardless of read_only.
      if (context?.sessionId && callerRecord === undefined) {
        throw new Error(
          'agentic_map: session has no nesting context. ' +
          'Session may be orphaned (post-cleanup timeout race) or created outside ' +
          'CipherAgent.createSession()/start(). Aborting to preserve ancestor invariants.',
        )
      }

      // [Guard D] Prevent write escalation from query context.
      // Sub-session commandType is derived from params.read_only, not from caller commandType.
      // Without this guard, a query session could pass read_only=false and spawn curate
      // children regardless of whether agentic_map is in the query allowlist.
      if (params.read_only === false && context?.commandType === 'query') {
        throw new Error(
          'agentic_map: read_only=false is not permitted from a query context. ' +
          'Query sessions are restricted to read-only operations.',
        )
      }

      // Three-way nesting branch
      let nestingDepth: number
      let effectiveMaxDepth: number
      let mapRunId: string
      let ancestorInputPaths: ReadonlySet<string>

      if (callerRecord !== undefined && !callerRecord.isRootCaller) {
        // ── Sub-session path ──────────────────────────────────────────────
        // callerRecord was set by processItem in a write-enabled parent run.
        // LLM cannot override inherited depth limit.
        nestingDepth = callerRecord.nestingDepth
        effectiveMaxDepth = callerRecord.absoluteMaxDepth
        mapRunId = callerRecord.mapRunId
        ancestorInputPaths = callerRecord.ancestorInputPaths
      } else {
        // ── Root path ─────────────────────────────────────────────────────
        // callerRecord.isRootCaller === true (pre-registered by CipherAgent.start/createSession)
        // OR no sessionId (read_only=true direct invocation — structurally unreachable via ToolManager)
        nestingDepth = 0
        effectiveMaxDepth = Math.min(params.max_depth ?? 1, HARD_MAX_DEPTH)
        mapRunId = randomUUID()
        ancestorInputPaths = new Set()
      }

      // ContextTreeStore construction — UNCHANGED from today
      const contextTreeStore = options?.generator && options?.tokenizer
        ? new ContextTreeStore({
            generator: options.generator,
            tauHard: Math.floor((options.maxContextTokens ?? 100_000) * 0.5),
            tokenizer: options.tokenizer,
          })
        : undefined

      const result = await _executeAgenticMap({
        abortSignal: context?.signal,
        agent,
        ancestorInputPaths,
        contextTreeStore,
        effectiveMaxDepth,
        logger: options?.logger,
        mapRunId,
        nestingDepth,
        onProgress: context?.metadata
          ? (progress) => {
              context.metadata!({
                description: `Processing items: ${progress.succeeded + progress.failed}/${progress.total}`,
                progress: Math.round(((progress.succeeded + progress.failed) / Math.max(progress.total, 1)) * 100),
              })
            }
          : undefined,
        params,
        taskId: context?.taskId,
        workingDirectory,
      })

      return {
        failed: result.failed,
        mapId: result.mapId,
        outputPath: params.output_path,
        succeeded: result.succeeded,
        ...(result.summaryHandle && {summaryHandle: result.summaryHandle}),
        total: result.total,
      }
    },

    getMetadata(args: Record<string, unknown>): ToolMetadata {
      return {
        affectedLocations: [args.output_path as string],
        category: 'execute',
        riskLevel: 'medium',
      }
    },

    id: 'agentic_map',
    inputSchema: AgenticMapParametersSchema,
  }
}
