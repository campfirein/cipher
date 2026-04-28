import type {ICipherAgent} from '../../../../agent/core/interfaces/i-cipher-agent.js'
import type {StalenessCheckResult, SummaryGenerationResult} from '../../domain/knowledge/summary-types.js'

/**
 * Service for managing hierarchical summary nodes (_index.md) in the context tree.
 *
 * Agent is passed per-call (not setter-based) to avoid race conditions
 * with concurrent tasks (AGENT_MAX_CONCURRENT_TASKS = 5).
 */
export interface IContextTreeSummaryService {
  /**
   * Check whether the summary for a directory is stale.
   * Returns isStale: true if no _index.md exists or if children hash has changed.
   */
  checkStaleness(directoryPath: string, directory?: string): Promise<StalenessCheckResult>

  /**
   * Generate or regenerate the _index.md summary for a directory.
   * Uses three-tier escalation: normal → aggressive → deterministic fallback.
   * Fail-open: returns { actionTaken: false } on any error.
   *
   * @param parentTaskId When supplied, summary LLM calls adopt this taskId as
   * their session grouping key on the wire so the billing service treats them
   * as part of the caller's operation rather than as standalone work.
   */
  generateSummary(
    directoryPath: string,
    agent: ICipherAgent,
    directory?: string,
    parentTaskId?: string,
  ): Promise<SummaryGenerationResult>

  /** Check whether a directory has an existing _index.md summary. */
  hasSummary(directoryPath: string, directory?: string): Promise<boolean>

  /**
   * Propagate staleness upward from changed paths.
   * Processes bottom-up: regenerates stale summaries from deepest to shallowest.
   * Stops climbing on LLM/IO errors; continues on empty directories.
   *
   * @param parentTaskId Threaded into `generateSummary` so every regeneration
   * triggered by one caller operation shares one billing group on the server.
   */
  propagateStaleness(
    changedPaths: string[],
    agent: ICipherAgent,
    directory?: string,
    parentTaskId?: string,
  ): Promise<SummaryGenerationResult[]>
}
