import type {ICipherAgent} from '../../../../agent/core/interfaces/i-cipher-agent.js'

/**
 * Options for executing folder pack with an injected agent.
 * Agent uses its default session (Single-Session pattern).
 */
export interface FolderPackExecuteOptions {
  /** Client's working directory for resolving relative paths (shell semantics) */
  clientCwd?: string
  /** Optional context to guide the analysis */
  content?: string
  /** Folder path to pack (relative to clientCwd or absolute). When absent, defaults to worktreeRoot. */
  folderPath?: string
  /** Canonical project root where .brv/ lives (for temp file location) */
  projectRoot?: string
  /** Task ID for event routing (required for concurrent task isolation) */
  taskId: string
  /** Workspace root — linked subdir or same as projectRoot. Used as default folderPath when none supplied. */
  worktreeRoot?: string
}

/**
 * IFolderPackExecutor - Executes folder pack + curate tasks with an injected CipherAgent.
 *
 * This executor:
 * 1. Packs the folder using FolderPackService
 * 2. Generates XML from the pack result
 * 3. Builds a prompt for the agent to analyze and curate the folder
 * 4. Executes with the agent
 *
 * Architecture:
 * - TaskProcessor injects the long-lived CipherAgent
 * - Event streaming is handled by agent-worker (subscribes to agentEventBus)
 * - Executor focuses solely on folder pack + curate execution
 */
export interface IFolderPackExecutor {
  /**
   * Execute folder pack + curate with an injected agent.
   *
   * @param agent - Long-lived CipherAgent (managed by caller)
   * @param options - Execution options (folderPath, context)
   * @returns Result string from agent execution
   */
  executeWithAgent(agent: ICipherAgent, options: FolderPackExecuteOptions): Promise<string>
}
