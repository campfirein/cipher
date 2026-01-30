import type { REPLResult, SandboxConfig } from '../domain/sandbox/types.js'

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
}
