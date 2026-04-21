import type { ValidatedHarnessConfig } from '../../infra/agent/agent-schemas.js'
import type { HarnessOutcomeRecorder } from '../../infra/harness/harness-outcome-recorder.js'
import type { ISearchKnowledgeService } from '../../infra/sandbox/tools-sdk.js'
import type { SessionManager } from '../../infra/session/session-manager.js'
import type { EnvironmentContext } from '../domain/environment/types.js'
import type { REPLResult, SandboxConfig } from '../domain/sandbox/types.js'
import type { IContentGenerator } from './i-content-generator.js'
import type { ICurateService } from './i-curate-service.js'
import type { IFileSystem } from './i-file-system.js'
import type { ILogger } from './i-logger.js'
import type { ISwarmCoordinator } from './i-swarm-coordinator.js'

/**
 * Service interface for code sandbox execution.
 * Provides isolated JavaScript/TypeScript code execution with security controls.
 */
export interface ISandboxService {
  /**
   * Clean up all resources (called on agent shutdown).
   */
  cleanup(): Promise<void>

  /**
   * Clear sandbox state for a session.
   *
   * @param sessionId - Session identifier
   */
  clearSession(sessionId: string): Promise<void>

  /**
   * Delete a variable from a session's sandbox.
   * If the sandbox doesn't exist yet, cleans up any pending variable with that key.
   *
   * @param sessionId - Session identifier
   * @param key - Variable name to delete
   */
  deleteSandboxVariable(sessionId: string, key: string): void

  /**
   * Execute JavaScript/TypeScript code in a sandbox.
   *
   * @param code - Code to execute (JavaScript or TypeScript)
   * @param sessionId - Agent session ID (state persists per session)
   * @param config - Optional execution configuration
   * @returns Execution result with stdout, stderr, and locals
   */
  executeCode(code: string, sessionId: string, config?: SandboxConfig): Promise<REPLResult>

  /**
   * Set the content generator for parallel LLM operations (mapExtract).
   * When set, sandboxes will have access to `tools.curation.mapExtract()`.
   *
   * @param contentGenerator - Content generator instance
   */
  setContentGenerator?(contentGenerator: IContentGenerator): void

  /**
   * Set the curate service for Tools SDK injection.
   * When set, sandboxes will have access to curate operations via `tools.curate()`.
   *
   * @param curateService - Curate service instance
   */
  setCurateService?(curateService: ICurateService): void

  /**
   * Set the environment context for sandbox injection.
   * When set, sandboxes will have access to environment info via `env.*` properties.
   *
   * @param environmentContext - Environment context object
   */
  setEnvironmentContext?(environmentContext: EnvironmentContext): void

  /**
   * Set the file system service for Tools SDK injection.
   * When set, sandboxes will have access to file system operations via `tools.*` methods.
   *
   * @param fileSystem - File system service instance
   */
  setFileSystem?(fileSystem: IFileSystem): void

  /**
   * Wire in the AutoHarness V2 config block.
   *
   * @param config - Harness config block from `AgentConfig.harness`
   */
  setHarnessConfig?(config: ValidatedHarnessConfig): void

  /**
   * Wire in the AutoHarness V2 outcome recorder for fire-and-forget
   * recording on every `executeCode` call.
   *
   * @param recorder - Outcome recorder instance
   * @param logger - Logger for defensive .catch on fire-and-forget calls
   */
  setHarnessOutcomeRecorder?(recorder: HarnessOutcomeRecorder, logger?: ILogger): void

  /**
   * Set a variable in a session's sandbox.
   * If the sandbox doesn't exist yet, the variable is buffered and injected
   * when the sandbox is created on the first executeCode() call.
   *
   * @param sessionId - Session identifier
   * @param key - Variable name
   * @param value - Variable value (must be JSON-serializable or a plain object)
   */
  setSandboxVariable(sessionId: string, key: string, value: unknown): void

  /**
   * Set the search knowledge service for Tools SDK injection.
   * When set, sandboxes will have access to knowledge search via `tools.searchKnowledge()`.
   *
   * @param searchKnowledgeService - Search knowledge service instance
   */
  setSearchKnowledgeService?(searchKnowledgeService: ISearchKnowledgeService): void

  /**
   * Set the session manager for sub-agent delegation.
   * When set, sandboxes will have access to `tools.agentQuery()`.
   *
   * @param sessionManager - Session manager instance
   */
  setSessionManager?(sessionManager: SessionManager): void

  /**
   * Set the swarm coordinator for cross-provider query and store.
   * When set, sandboxes will have access to `tools.swarmQuery()` and `tools.swarmStore()`.
   *
   * @param swarmCoordinator - Swarm coordinator instance
   */
  setSwarmCoordinator?(swarmCoordinator: ISwarmCoordinator): void
}
