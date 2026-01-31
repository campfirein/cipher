import type { ISearchKnowledgeService } from '../../infra/sandbox/tools-sdk.js'
import type { REPLResult, SandboxConfig } from '../domain/sandbox/types.js'
import type { IFileSystem } from './i-file-system.js'

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
   * Execute JavaScript/TypeScript code in a sandbox.
   *
   * @param code - Code to execute (JavaScript or TypeScript)
   * @param sessionId - Agent session ID (state persists per session)
   * @param config - Optional execution configuration
   * @returns Execution result with stdout, stderr, and locals
   */
  executeCode(code: string, sessionId: string, config?: SandboxConfig): Promise<REPLResult>

  /**
   * Set the file system service for Tools SDK injection.
   * When set, sandboxes will have access to file system operations via `tools.*` methods.
   *
   * @param fileSystem - File system service instance
   */
  setFileSystem?(fileSystem: IFileSystem): void

  /**
   * Set the search knowledge service for Tools SDK injection.
   * When set, sandboxes will have access to knowledge search via `tools.searchKnowledge()`.
   *
   * @param searchKnowledgeService - Search knowledge service instance
   */
  setSearchKnowledgeService?(searchKnowledgeService: ISearchKnowledgeService): void
}
