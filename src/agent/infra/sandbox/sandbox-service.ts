import type { EnvironmentContext } from '../../core/domain/environment/types.js'
import type { REPLResult, SandboxConfig } from '../../core/domain/sandbox/types.js'
import type { IFileSystem } from '../../core/interfaces/i-file-system.js'
import type { ISandboxService } from '../../core/interfaces/i-sandbox-service.js'
import type { ISearchKnowledgeService, ToolsSDK } from './tools-sdk.js'

import { LocalSandbox } from './local-sandbox.js'
import { createToolsSDK } from './tools-sdk.js'

/**
 * Sandbox service implementation.
 * Manages sandbox instances tied to agent sessions.
 */
export class SandboxService implements ISandboxService {
  /** Environment context for sandbox injection */
  private environmentContext?: EnvironmentContext
  /** File system service for Tools SDK */
  private fileSystem?: IFileSystem
  /** Map of agent sessionId to LocalSandbox instance */
  private sandboxes = new Map<string, LocalSandbox>()
  /** Search knowledge service for Tools SDK */
  private searchKnowledgeService?: ISearchKnowledgeService
  /** Cached Tools SDK instance (created when fileSystem is set) */
  private toolsSDK?: ToolsSDK

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

      sandbox = new LocalSandbox({
        environmentContext: this.environmentContext,
        initialContext,
        toolsSDK: this.toolsSDK,
      })
      this.sandboxes.set(sessionId, sandbox)
    }
    else if (config?.contextPayload) {
      // Update context if provided
      sandbox.updateContext({ context: config.contextPayload })
    }

    return sandbox.execute(code, config)
  }

  /**
   * Set the environment context for sandbox injection.
   * When set, new sandboxes will have access to environment info via `env.*` properties.
   *
   * @param environmentContext - Environment context object
   */
  setEnvironmentContext(environmentContext: EnvironmentContext): void {
    this.environmentContext = environmentContext
    // Clear existing sandboxes so new ones get the updated environment
    this.sandboxes.clear()
  }

  /**
   * Set the file system service for Tools SDK injection.
   * When set, new sandboxes will have access to file system operations via `tools.*` methods.
   *
   * @param fileSystem - File system service instance
   */
  setFileSystem(fileSystem: IFileSystem): void {
    this.fileSystem = fileSystem
    this.rebuildToolsSDK()
  }

  /**
   * Set the search knowledge service for Tools SDK injection.
   * When set, new sandboxes will have access to knowledge search via `tools.searchKnowledge()`.
   *
   * @param searchKnowledgeService - Search knowledge service instance
   */
  setSearchKnowledgeService(searchKnowledgeService: ISearchKnowledgeService): void {
    this.searchKnowledgeService = searchKnowledgeService
    this.rebuildToolsSDK()
  }

  /**
   * Rebuild the Tools SDK instance when services change.
   * Clears existing sandboxes so new ones get the updated SDK.
   */
  private rebuildToolsSDK(): void {
    if (this.fileSystem) {
      this.toolsSDK = createToolsSDK(this.fileSystem, this.searchKnowledgeService)
      // Clear existing sandboxes so new ones get the updated tools SDK
      // Note: This means existing sessions lose their state when services are updated
      // This is acceptable since services are typically set once at startup
      this.sandboxes.clear()
    }
  }
}
