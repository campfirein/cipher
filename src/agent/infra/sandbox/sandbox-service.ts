import type { EnvironmentContext } from '../../core/domain/environment/types.js'
import type {
  HarnessContext,
  HarnessLoadResult,
  HarnessMeta,
  HarnessModule,
  ProjectType,
} from '../../core/domain/harness/types.js'
import type { REPLResult, SandboxConfig } from '../../core/domain/sandbox/types.js'
import type { IContentGenerator } from '../../core/interfaces/i-content-generator.js'
import type { ICurateService } from '../../core/interfaces/i-curate-service.js'
import type { IFileSystem } from '../../core/interfaces/i-file-system.js'
import type { IHarnessStore } from '../../core/interfaces/i-harness-store.js'
import type { ILogger } from '../../core/interfaces/i-logger.js'
import type { ISandboxService } from '../../core/interfaces/i-sandbox-service.js'
import type { ISwarmCoordinator } from '../../core/interfaces/i-swarm-coordinator.js'
import type { ValidatedHarnessConfig } from '../agent/agent-schemas.js'
import type { HarnessModuleBuilder } from '../harness/harness-module-builder.js'
import type { HarnessOutcomeRecorder } from '../harness/harness-outcome-recorder.js'
import type { SessionManager } from '../session/session-manager.js'
import type { ISearchKnowledgeService, ToolsSDK } from './tools-sdk.js'

import { ProjectTypeSchema } from '../../core/domain/harness/types.js'
import {HarnessEvaluatorError} from '../harness/harness-evaluator-errors.js'
import { OpsCounter } from '../harness/ops-counter.js'
import {CurateResultCollector} from './curate-result-collector.js'
import { LocalSandbox } from './local-sandbox.js'
import { createToolsSDK } from './tools-sdk.js'

/**
 * Per-session harness state captured after a successful `loadHarness`.
 * Holds the callable module + the metadata the template declared, so
 * subsequent `executeCode` calls can inject `harness.*` into the
 * sandbox context without re-invoking the module builder.
 */
interface SessionHarnessState {
  readonly commandType: 'chat' | 'curate' | 'query'
  readonly meta: HarnessMeta
  readonly module: HarnessModule
  readonly projectType: ProjectType
}

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
  /** AutoHarness V2 config block, wired in before any session is created. */
  private harnessConfig?: ValidatedHarnessConfig
  /** AutoHarness V2 module builder — evaluates harness code per session. */
  private harnessModuleBuilder?: HarnessModuleBuilder
  /** AutoHarness V2 outcome recorder — fire-and-forget from executeCode. */
  private harnessOutcomeRecorder?: HarnessOutcomeRecorder
  /** AutoHarness V2 storage — reads latest HarnessVersion on loadHarness. */
  private harnessStore?: IHarnessStore
  /** Current harness version ID per session, populated by Phase 3 loadHarness. */
  private harnessVersionIdBySession = new Map<string, string>()
  /** Logger for defensive .catch on fire-and-forget record calls. */
  private logger?: ILogger
  /** Variables buffered before sandbox creation, keyed by sessionId */
  private pendingVariables = new Map<string, Record<string, unknown>>()
  /** Command type used to build each sandbox's ToolsSDK, keyed by sessionId */
  private sandboxCommandTypes = new Map<string, string | undefined>()
  /** Map of agent sessionId to LocalSandbox instance */
  private sandboxes = new Map<string, LocalSandbox>()
  /** Search knowledge service for Tools SDK */
  private searchKnowledgeService?: ISearchKnowledgeService
  /** Per-session harness state after loadHarness; drives harness.* injection. */
  private sessionHarnessStates = new Map<string, SessionHarnessState>()
  /** Session manager for sub-agent delegation via tools.agentQuery() */
  private sessionManager?: SessionManager
  /** Swarm coordinator for cross-provider query and store */
  private swarmCoordinator?: ISwarmCoordinator

  /**
   * Clean up all resources (called on agent shutdown).
   */
  async cleanup(): Promise<void> {
    this.harnessOutcomeRecorder?.cleanup()
    this.harnessVersionIdBySession.clear()
    this.sessionHarnessStates.clear()
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
    this.harnessOutcomeRecorder?.clearSession(sessionId)
    this.harnessVersionIdBySession.delete(sessionId)
    this.sessionHarnessStates.delete(sessionId)
    this.sandboxes.delete(sessionId)
    this.sandboxCommandTypes.delete(sessionId)
    this.pendingVariables.delete(sessionId)
  }

  /**
   * Public accessor for `buildHarnessTools` — consumed by the
   * `HarnessEvaluator` to construct dryRun-enabled tool contexts.
   * Keeps one tools-construction path; the `dryRun` flag is the
   * only branch.
   */
  createHarnessTools(options?: {dryRun?: boolean}): HarnessContext['tools'] {
    return this.buildHarnessTools(options)
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

      // Inject harness.* namespace if a harness module is loaded for this
      // session (via loadHarness()). When no harness is loaded, the
      // sandbox context has no `harness` entry and user code runs
      // against raw `tools.*` orchestration.
      const harnessNs = this.buildHarnessNamespace(sessionId)
      if (harnessNs !== undefined) {
        initialContext.harness = harnessNs
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

    let result: REPLResult

    if (this.collector) {
      const collected = await this.collector.collect(() => sandbox.execute(code, config))
      result = collected.curateResults.length > 0
        ? {...collected.result, curateResults: collected.curateResults}
        : collected.result
    } else {
      result = await sandbox.execute(code, config)
    }

    // Fire-and-forget: record outcome in the background. The recorder's
    // internal contract (Task 2.1) swallows errors, but the try/catch +
    // .catch are belt-and-braces against programming bugs in the recorder.
    if (this.harnessOutcomeRecorder && this.environmentContext?.workingDirectory) {
      const ct = config?.commandType
      if (ct !== undefined && ct !== 'chat' && ct !== 'curate' && ct !== 'query') {
        this.logger?.debug('harness.record: unknown commandType mapped to chat', {commandType: ct})
      }

      const commandType = ct === 'curate' || ct === 'query' ? ct : 'chat'
      try {
        this.harnessOutcomeRecorder
          .record({
            code,
            commandType,
            conversationTurn: config?.conversationTurn,
            executionTimeMs: result.executionTime,
            harnessVersionId: this.harnessVersionIdBySession.get(sessionId),
            projectId: this.environmentContext.workingDirectory,
            projectType: this.resolveProjectType(),
            result,
            sessionId,
            taskDescription: config?.taskDescription,
          })
          .catch((error: unknown) => {
            this.logger?.warn('harness.record rejected', {error})
          })
      } catch (error) {
        this.logger?.warn('harness.record threw', {error})
      }
    }

    return result
  }

  /**
   * Load the latest harness version for `(projectId, commandType)` and
   * register it on `sessionId` so future `executeCode` calls inject
   * `harness.*` into the sandbox context.
   *
   * Never throws — every failure is encoded in the returned
   * `HarnessLoadResult`. A `{loaded: false}` result leaves the session
   * untouched; the sandbox continues with raw `tools.*` orchestration.
   * On `{loaded: true}`, the method also populates
   * `harnessVersionIdBySession` so Phase 2's recorder can attribute
   * outcomes to the loaded version, and — if the session's sandbox
   * already exists — injects `harness.*` into its context immediately.
   *
   * Harness mode is hardcoded to the Phase 3 "assisted" baseline;
   * Phase 5's `HarnessModeSelector` will layer mode gating on top.
   */
  async loadHarness(
    sessionId: string,
    projectId: string,
    commandType: 'chat' | 'curate' | 'query',
  ): Promise<HarnessLoadResult> {
    // Deliberate: three distinct conditions (admin-disabled,
    // store not wired, builder not wired) collapse into the same
    // 'no-version' result for v1.0. `HarnessLoadResult` doesn't
    // distinguish 'disabled' / 'not-configured' / 'no-version' as
    // separate reasons because no consumer yet needs to branch on
    // them — Phase 5's mode selector is the first real caller and
    // will add variants if the downstream telemetry needs them.
    // Keep this conflation intentional, not accidental.
    if (
      this.harnessConfig?.enabled !== true ||
      this.harnessStore === undefined ||
      this.harnessModuleBuilder === undefined
    ) {
      return {loaded: false, reason: 'no-version'}
    }

    const version = await this.harnessStore.getLatest(projectId, commandType)
    if (version === undefined) {
      return {loaded: false, reason: 'no-version'}
    }

    const result = this.harnessModuleBuilder.build(version)
    if (!result.loaded) {
      this.logger?.warn('SandboxService.loadHarness: builder returned failure', {
        commandType,
        projectId,
        reason: result.reason,
        versionId: version.id,
      })
      return result
    }

    this.sessionHarnessStates.set(sessionId, {
      commandType,
      meta: result.module.meta(),
      module: result.module,
      projectType: this.resolveProjectType(),
    })
    this.harnessVersionIdBySession.set(sessionId, result.version.id)

    // If the sandbox already exists, inject now. Otherwise `executeCode`
    // picks up the namespace at sandbox-creation time via the
    // `buildHarnessNamespace` check in the creation block.
    //
    // `buildHarnessNamespace` only returns `undefined` when no state is
    // registered for `sessionId` — we just set it above, so the result
    // is guaranteed non-undefined here. No need to re-guard.
    const sandbox = this.sandboxes.get(sessionId)
    if (sandbox !== undefined) {
      sandbox.updateContext({harness: this.buildHarnessNamespace(sessionId)})
    }

    return result
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
   * Wire in the AutoHarness V2 config block. Consumers read individual
   * flags (`enabled`, `autoLearn`, `language`, `modeOverride`) off the
   * stored block; a config update requires another `setHarnessConfig` call.
   *
   * @param config - Harness config block from `AgentConfig.harness`
   */
  setHarnessConfig(config: ValidatedHarnessConfig): void {
    this.harnessConfig = config
  }

  /**
   * Wire in the AutoHarness V2 module builder. `loadHarness` uses this
   * to evaluate the `HarnessVersion.code` string returned by the store
   * into a callable module.
   */
  setHarnessModuleBuilder(builder: HarnessModuleBuilder): void {
    this.harnessModuleBuilder = builder
  }

  /**
   * Wire in the AutoHarness V2 outcome recorder. When set, every
   * `executeCode` call fire-and-forgets a `recorder.record(...)` with the
   * sandbox result. Errors from the recorder never propagate to the caller.
   *
   * @param recorder - Outcome recorder instance
   * @param logger - Logger for defensive .catch on fire-and-forget calls
   */
  setHarnessOutcomeRecorder(recorder: HarnessOutcomeRecorder, logger?: ILogger): void {
    this.harnessOutcomeRecorder = recorder
    this.logger = logger
  }

  /**
   * Wire in the AutoHarness V2 storage interface. `loadHarness` calls
   * `store.getLatest(projectId, commandType)` to find the version to
   * evaluate.
   */
  setHarnessStore(store: IHarnessStore): void {
    this.harnessStore = store
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
   * Set the swarm coordinator for cross-provider query and store.
   * When set, sandboxes will have access to `tools.swarmQuery()` and `tools.swarmStore()`.
   *
   * @param swarmCoordinator - Swarm coordinator instance
   */
  setSwarmCoordinator(swarmCoordinator: ISwarmCoordinator): void {
    this.swarmCoordinator = swarmCoordinator
    this.invalidateSandboxes()
  }

  /**
   * Build the `harness.*` namespace for a session, or `undefined` if
   * no harness is loaded. Each call to `harness.curate()` /
   * `harness.query()` constructs a fresh `HarnessContext` so the
   * `abort` signal and tool bindings are session-current. `meta`
   * returns the captured metadata without re-invoking the VM.
   */
  private buildHarnessNamespace(sessionId: string): Record<string, unknown> | undefined {
    const state = this.sessionHarnessStates.get(sessionId)
    if (state === undefined) return undefined

    const {commandType, meta, module, projectType} = state
    const workingDirectory = this.environmentContext?.workingDirectory ?? ''

    const buildCtx = (): HarnessContext => ({
      // Phase 3 placeholder: a fresh signal per call. Phase 5's
      // `AgentLLMService` hook will thread the session's real abort
      // signal through so `ctx.abort` propagates user cancellation.
      abort: new AbortController().signal,
      env: {commandType, projectType, workingDirectory},
      tools: this.buildHarnessTools(),
    })

    const ns: Record<string, unknown> = {
      meta: (): HarnessMeta => meta,
    }

    if (module.curate !== undefined) {
      const curateFn = module.curate
      ns.curate = async (): Promise<unknown> => curateFn(buildCtx())
    }

    if (module.query !== undefined) {
      const queryFn = module.query
      ns.query = async (): Promise<unknown> => queryFn(buildCtx())
    }

    return ns
  }

  /**
   * Build the `HarnessContext['tools']` surface by binding the two
   * v1.0 methods (`curate`, `readFile`) to the service's real tool
   * instances. Each bound function throws if the underlying service
   * isn't wired — the harness code sees a normal runtime error rather
   * than a silent no-op.
   *
   * When `options.dryRun` is `true`, write-capable tools (`curate`)
   * throw `HarnessEvaluatorError('WRITE_BLOCKED_DURING_EVAL')` instead
   * of executing. Read-only tools (`readFile`) remain unblocked.
   * The evaluator uses this for side-effect-free candidate scoring.
   */
  private buildHarnessTools(options?: {dryRun?: boolean}): HarnessContext['tools'] {
    const {curateService} = this
    const {fileSystem} = this
    const writeBlocked = options?.dryRun === true
    // Fresh counter per outer harness invocation. The `buildCtx` helper
    // calls `buildHarnessTools()` each time `harness.curate()` /
    // `harness.query()` fires, so the counter's scope is naturally one
    // outer call — no explicit reset needed.
    //
    // Caps apply unconditionally (all modes). Always-on enforcement
    // prevents a "mode not set yet" bypass window.
    const opsCounter = new OpsCounter()
    return {
      async curate(operations, opts) {
        // dryRun blocks writes before anything else — no ops counted,
        // no service check. The evaluator sees a clean rejection.
        if (writeBlocked) {
          throw new HarnessEvaluatorError('WRITE_BLOCKED_DURING_EVAL')
        }

        // Service-wired check FIRST — a misconfiguration error never
        // reaches the real tool, so it shouldn't consume op budget.
        if (curateService === undefined) {
          throw new Error('harness.ctx.tools.curate: no curate service wired')
        }

        opsCounter.increment()
        return curateService.curate(operations, opts)
      },
      async readFile(filePath, opts) {
        if (fileSystem === undefined) {
          throw new Error('harness.ctx.tools.readFile: no file system wired')
        }

        opsCounter.increment()
        return fileSystem.readFile(filePath, opts)
      },
    }
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
      swarmCoordinator: this.swarmCoordinator,
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

  /**
   * Map `harnessConfig.language` to a `ProjectType`. `'auto'` and absent
   * language both resolve to `'generic'`; Phase 4 bootstrap will formalize
   * richer detection. Uses `ProjectTypeSchema.safeParse` so new values
   * added to the schema are automatically accepted without a code change.
   */
  private resolveProjectType(): ProjectType {
    const parsed = ProjectTypeSchema.safeParse(this.harnessConfig?.language)
    return parsed.success ? parsed.data : 'generic'
  }
}
