import type { REPLResult, SandboxConfig } from '../../core/domain/sandbox/types.js'
import type { ISandboxService } from '../../core/interfaces/i-sandbox-service.js'

import { LocalSandbox } from './local-sandbox.js'

/**
 * Sandbox service implementation.
 * Manages sandbox instances tied to agent sessions.
 */
export class SandboxService implements ISandboxService {
  /** Map of agent sessionId to LocalSandbox instance */
  private sandboxes = new Map<string, LocalSandbox>()

  /**
   * Clean up all resources (called on agent shutdown).
   */
  async cleanup(): Promise<void> {
    this.sandboxes.clear()
  }

  /**
   * Clear sandbox state for a session.
   *
   * @param sessionId - Session identifier
   */
  async clearSession(sessionId: string): Promise<void> {
    this.sandboxes.delete(sessionId)
  }

  /**
   * Execute JavaScript/TypeScript code in a sandbox.
   *
   * @param code - Code to execute
   * @param sessionId - Agent session ID (state persists per session)
   * @param config - Optional execution configuration
   * @returns Execution result
   */
  async executeCode(code: string, sessionId: string, config?: SandboxConfig): Promise<REPLResult> {
    // Get or create sandbox for this agent session
    let sandbox = this.sandboxes.get(sessionId)

    if (!sandbox) {
      // First execution for this session - create new sandbox
      const initialContext: Record<string, unknown> = {}
      if (config?.contextPayload) {
        initialContext.context = config.contextPayload
      }

      sandbox = new LocalSandbox(initialContext)
      this.sandboxes.set(sessionId, sandbox)
    }
    else if (config?.contextPayload) {
      // Update context if provided
      sandbox.updateContext({ context: config.contextPayload })
    }

    return sandbox.execute(code, config)
  }
}
