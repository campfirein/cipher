import type { EnvironmentContext } from '../../core/domain/environment/types.js'
import type { REPLResult, SandboxConfig } from '../../core/domain/sandbox/types.js'
import type { IContentGenerator } from '../../core/interfaces/i-content-generator.js'
import type { ICurateService } from '../../core/interfaces/i-curate-service.js'
import type { IFileSystem } from '../../core/interfaces/i-file-system.js'
import type { ISandboxService } from '../../core/interfaces/i-sandbox-service.js'
import type { SessionManager } from '../session/session-manager.js'
import type { ISearchKnowledgeService, ToolsSDK } from './tools-sdk.js'

import {CurateResultCollector} from './curate-result-collector.js'
import { LocalSandbox } from './local-sandbox.js'
import { createToolsSDK } from './tools-sdk.js'

/**
 * Sandbox service implementation.
 * Manages sandbox instances tied to agent sessions.
 */
export class SandboxService implements ISandboxService {
  /** Collector wrapping curateService — captures curate() results per executeCode() call */
  private collector?: CurateResultCollector
  /** Content generator for parallel LLM operations (mapExtract) */
  private contentGenerator?: IContentGenerator
  /** Curate service for Tools SDK */
  private curateService?: ICurateService
  /** Environment context for sandbox injection */
  private environmentContext?: EnvironmentContext
  /** File system service for Tools SDK */
  private fileSystem?: IFileSystem
  /** Variables buffered before sandbox creation, keyed by sessionId */
  private pendingVariables = new Map<string, Record<string, unknown>>()
  /** Command type used to build each sandbox's ToolsSDK, keyed by sessionId */
  private sandboxCommandTypes = new Map<string, string | undefined>()
  /** Map of agent sessionId to LocalSandbox instance */
  private sandboxes = new Map<string, LocalSandbox>()
  /** Search knowledge service for Tools SDK */
  private searchKnowledgeService?: ISearchKnowledgeService
  /** Session manager for sub-agent delegation via tools.agentQuery() */
  private sessionManager?: SessionManager

  /**
   * Clean up all resources (called on agent shutdown).
   */
  async cleanup(): Promise<void> {
    this.sandboxes.clear()
    this.sandboxCommandTypes.clear()
    this.pendingVariables.clear()
  }

  /**
   * Clear sandbox state for a session.
   *
   * @param sessionId - Session identifier
   */
  async clearSession(sessionId: string): Promise<void> {
    this.sandboxes.delete(sessionId)
    this.sandboxCommandTypes.delete(sessionId)
    this.pendingVariables.delete(sessionId)
  }

  /**
   * Delete a variable from a session's sandbox.
   * If the sandbox doesn't exist yet, cleans up any pending variable with that key.
   *
   * @param sessionId - Session identifier
   * @param key - Variable name to delete
   */
  deleteSandboxVariable(sessionId: string, key: string): void {
    const sandbox = this.sandboxes.get(sessionId)
    if (sandbox) {
      sandbox.updateContext({ [key]: undefined })
    }

    const pending = this.pendingVariables.get(sessionId)
    if (pending) {
      delete pending[key]
    }
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

    if (sandbox) {
      // Hot-swap ToolsSDK if commandType changed (security: enforce read-only on transition)
      const previousCommandType = this.sandboxCommandTypes.get(sessionId)
      if (config?.commandType !== previousCommandType) {
        const newToolsSDK = this.buildToolsSDK(sessionId, config?.commandType)
        if (newToolsSDK) {
          sandbox.updateContext({ tools: newToolsSDK })
        }

        this.sandboxCommandTypes.set(sessionId, config?.commandType)
      }

      // Update context if provided
      if (config?.contextPayload) {
        sandbox.updateContext({ context: config.contextPayload })
      }
    }
    else {
      // First execution for this session - create new sandbox
      const initialContext: Record<string, unknown> = {}
      if (config?.contextPayload) {
        initialContext.context = config.contextPayload
      }

      // Inject any pending variables set before sandbox creation
      const pending = this.pendingVariables.get(sessionId)
      if (pending) {
        Object.assign(initialContext, pending)
        this.pendingVariables.delete(sessionId)
      }

      // Build per-session ToolsSDK (includes agentQuery bound to this sessionId)
      const sessionToolsSDK = this.buildToolsSDK(sessionId, config?.commandType)

      sandbox = new LocalSandbox({
        environmentContext: this.environmentContext,
        initialContext,
        toolsSDK: sessionToolsSDK,
      })

      this.sandboxes.set(sessionId, sandbox)
      this.sandboxCommandTypes.set(sessionId, config?.commandType)
    }

    if (this.collector) {
      const {curateResults, result} = await this.collector.collect(() => sandbox.execute(code, config))
      return curateResults.length > 0 ? {...result, curateResults} : result
    }

    return sandbox.execute(code, config)
  }

  /**
   * Set the content generator for parallel LLM operations (mapExtract).
   * When set, new sandboxes will have access to `tools.curation.mapExtract()`.
   *
   * @param contentGenerator - Content generator instance
   */
  setContentGenerator(contentGenerator: IContentGenerator): void {
    this.contentGenerator = contentGenerator
    this.invalidateSandboxes()
  }

  /**
   * Set the curate service for Tools SDK injection.
   * When set, new sandboxes will have access to curate operations via `tools.curate()`.
   *
   * @param curateService - Curate service instance
   */
  setCurateService(curateService: ICurateService): void {
    this.collector = new CurateResultCollector(curateService)
    this.curateService = this.collector
    this.invalidateSandboxes()
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
    this.sandboxCommandTypes.clear()
  }

  /**
   * Set the file system service for Tools SDK injection.
   * When set, new sandboxes will have access to file system operations via `tools.*` methods.
   *
   * @param fileSystem - File system service instance
   */
  setFileSystem(fileSystem: IFileSystem): void {
    this.fileSystem = fileSystem
    this.invalidateSandboxes()
  }

  /**
   * Set a variable in a session's sandbox.
   * If the sandbox doesn't exist yet, the variable is buffered and injected
   * when the sandbox is created on the first executeCode() call.
   *
   * @param sessionId - Session identifier
   * @param key - Variable name
   * @param value - Variable value
   */
  setSandboxVariable(sessionId: string, key: string, value: unknown): void {
    const sandbox = this.sandboxes.get(sessionId)
    if (sandbox) {
      sandbox.updateContext({ [key]: value })
    } else {
      // Buffer — will be injected when sandbox is created in executeCode()
      let pending = this.pendingVariables.get(sessionId)
      if (!pending) {
        pending = {}
        this.pendingVariables.set(sessionId, pending)
      }

      pending[key] = value
    }
  }

  /**
   * Set the search knowledge service for Tools SDK injection.
   * When set, new sandboxes will have access to knowledge search via `tools.searchKnowledge()`.
   *
   * @param searchKnowledgeService - Search knowledge service instance
   */
  setSearchKnowledgeService(searchKnowledgeService: ISearchKnowledgeService): void {
    this.searchKnowledgeService = searchKnowledgeService
    this.invalidateSandboxes()
  }

  /**
   * Set the session manager for sub-agent delegation.
   * When set, new sandboxes will have access to `tools.agentQuery()`.
   *
   * @param sessionManager - Session manager instance
   */
  setSessionManager(sessionManager: SessionManager): void {
    this.sessionManager = sessionManager
  }

  /**
   * Build a Tools SDK instance for a specific session.
   * Includes `agentQuery` bound to the session's ID for sub-agent delegation.
   */
  private buildToolsSDK(sessionId: string, commandType?: string): ToolsSDK | undefined {
    if (!this.fileSystem) {
      return undefined
    }

    return createToolsSDK({
      commandType,
      contentGenerator: this.contentGenerator,
      curateService: this.curateService,
      fileSystem: this.fileSystem,
      parentSessionId: sessionId,
      projectRoot: this.environmentContext?.workingDirectory,
      sandboxService: this,
      searchKnowledgeService: this.searchKnowledgeService,
      sessionManager: this.sessionManager,
    })
  }

  /**
   * Clear existing sandboxes so new ones get updated services.
   * Called when file system, curate, or search services change.
   */
  private invalidateSandboxes(): void {
    if (this.fileSystem) {
      this.sandboxes.clear()
      this.sandboxCommandTypes.clear()
    }
  }
}
