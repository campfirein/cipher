import type {ICipherAgent} from '../../../../agent/core/interfaces/i-cipher-agent.js'

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
   * Curate-log identifier (cur-<timestamp>) assigned by `CurateLogHandler.onTaskCreate`,
   * forwarded by the task-router via `TaskExecuteSchema.logId`. The executor passes
   * it to services-adapter so each curated leaf's `Reason` field can carry the
   * source curate-log id for audit-trail provenance (Phase 2.5 R-3).
   * Optional — undefined for direct-test invocations that bypass the router.
   */
  logId?: string
  /** Canonical project root where .brv/ lives (for post-processing: snapshot, summary, manifest) */
  projectRoot?: string
  /** Task ID for event routing (required for concurrent task isolation) */
  taskId: string
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
