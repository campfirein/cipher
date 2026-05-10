import type {ICipherAgent} from '../../../../agent/core/interfaces/i-cipher-agent.js'
import type {CurateUsageRecord} from '../../../infra/process/curate-log-handler.js'
import type {TaskUsageAggregator} from '../../../infra/telemetry/task-usage-aggregator.js'

/**
 * Options for executing curate with an injected agent.
 * Agent uses its default session (Single-Session pattern).
 */
export interface CurateExecuteOptions {
  /** Client's working directory for file validation (defaults to process.cwd() if not provided) */
  clientCwd?: string
  /** Context content to curate */
  content: string
  /** Optional file paths for --files flag */
  files?: string[]
  /**
   * Telemetry sink invoked by the executor at completion with the rolled-up
   * curate-side telemetry . The wiring layer plugs this into
   * `CurateLogHandler.setCurateUsage(taskId, record)` so the entry on disk
   * gets the new fields.
   */
  onTelemetry?: (record: CurateUsageRecord) => void
  /** Canonical project root where .brv/ lives (for post-processing: snapshot, summary, manifest) */
  projectRoot?: string
  /** Task ID for event routing (required for concurrent task isolation) */
  taskId: string
  /**
   * Optional per-task usage aggregator. When provided, the executor reads
   * its rolled-up totals at completion and feeds them to {@link onTelemetry}.
   * The caller is responsible for subscribing the aggregator to the agent's
   * `llmservice:usage` event stream (TODO: agent-process integration).
   *
   */
  usageAggregator?: TaskUsageAggregator
  /** Workspace root — linked subdir or same as projectRoot for direct projects */
  worktreeRoot?: string
}

/**
 * ICurateExecutor - Executes curate tasks with an injected CipherAgent.
 *
 * This is NOT a UseCase (which orchestrates business logic).
 * It's an Executor that wraps agent.execute() with curate-specific options.
 *
 * Architecture:
 * - AgentProcess injects the long-lived CipherAgent
 * - Event streaming is handled by agent-process (subscribes to agentEventBus)
 * - Executor focuses solely on curate execution
 */
export interface ICurateExecutor {
  /**
   * Execute curate with an injected agent.
   *
   * @param agent - Long-lived CipherAgent (managed by caller)
   * @param options - Execution options (content, file references)
   * @returns Result string from agent execution
   */
  executeWithAgent(agent: ICipherAgent, options: CurateExecuteOptions): Promise<string>
}
