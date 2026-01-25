import type {CipherAgentServices} from '../interfaces/cipher-services.js'
import type {AgentEventBus} from '../events/event-emitter.js'

import {AgentError} from './agent-error.js'
import {AgentConfigSchema, type LLMUpdates, LLMUpdatesSchema, type ValidatedAgentConfig, type ValidatedLLMConfig} from './agent-schemas.js'
import {AgentStateManager} from './agent-state-manager.js'

/**
 * Abstract base agent class encapsulating DextoAgent patterns.
 *
 * Provides:
 * - Two-phase initialization (constructor + start)
 * - Lifecycle management (start, stop, restart)
 * - State management with session overrides
 * - Typed error handling
 * - Configuration validation
 *
 * Subclasses must implement:
 * - initializeServices(): Create agent-specific services
 * - cleanupServices(): Cleanup on stop
 */
export abstract class BaseAgent {
  // === Lifecycle State ===
  protected _isStarted: boolean = false
  protected _isStopped: boolean = false
  // === Configuration ===
  public readonly config: ValidatedAgentConfig
  // === Services (initialized in start()) ===
  protected services?: CipherAgentServices
  protected stateManager?: AgentStateManager

  /**
   * Create a new agent instance.
   * Does NOT initialize services - call start() for async initialization.
   *
   * @param config - Agent configuration (will be validated with Zod)
   * @throws AgentError if configuration validation fails
   */
  constructor(config: unknown) {
    // Validate and transform config using Zod schema
    const parseResult = AgentConfigSchema.safeParse(config)
    if (!parseResult.success) {
      throw AgentError.invalidConfig('Configuration validation failed', parseResult.error.format())
    }

    this.config = parseResult.data
  }

  /**
   * Cleanup agent-specific services.
   * Called during stop().
   */
  protected abstract cleanupServices(): Promise<void>

  /**
   * Clear session-specific configuration overrides.
   */
  public clearSessionConfig(sessionId: string): void {
    this.ensureStarted()
    this.getStateManager().clearSessionOverride(sessionId)
  }

  /**
   * Ensure the agent is started before operations.
   * @throws AgentError if not started or stopped
   */
  protected ensureStarted(): void {
    if (this._isStopped && !this._isStarted) {
      throw AgentError.stopped()
    }

    if (!this._isStarted) {
      throw AgentError.notStarted()
    }
  }

  /**
   * Get the agent event bus (for subscribing to events).
   */
  public getAgentEventBus(): AgentEventBus {
    this.ensureStarted()
    return this.getServices().agentEventBus
  }

  /**
   * Get the baseline configuration (original config, never modified).
   */
  public getBaselineConfig(): Readonly<ValidatedAgentConfig> {
    this.ensureStarted()
    return this.getStateManager().getBaselineConfig()
  }

  /**
   * Get effective configuration for a session.
   * Includes session-specific overrides if sessionId is provided.
   */
  public getEffectiveConfig(sessionId?: string): Readonly<ValidatedAgentConfig> {
    this.ensureStarted()
    return this.getStateManager().getRuntimeConfig(sessionId)
  }

  /**
   * Get current LLM configuration.
   */
  public getLLMConfig(sessionId?: string): Readonly<ValidatedLLMConfig> {
    this.ensureStarted()
    return this.getStateManager().getLLMConfig(sessionId)
  }

  /**
   * Get services (guaranteed to be defined after start).
   */
  protected getServices(): CipherAgentServices {
    if (!this.services) {
      throw AgentError.serviceNotInitialized('CipherAgentServices')
    }

    return this.services
  }

  /**
   * Get the state manager (guaranteed to be defined after start).
   */
  protected getStateManager(): AgentStateManager {
    if (!this.stateManager) {
      throw AgentError.serviceNotInitialized('AgentStateManager')
    }

    return this.stateManager
  }

  /**
   * Initialize agent-specific services.
   * Called during start().
   */
  protected abstract initializeServices(): Promise<CipherAgentServices>

  /**
   * Check if the agent is started.
   */
  public isStarted(): boolean {
    return this._isStarted
  }

  /**
   * Check if the agent is stopped.
   */
  public isStopped(): boolean {
    return this._isStopped
  }

  /**
   * Reset configuration to baseline.
   */
  public resetConfig(): void {
    this.ensureStarted()
    this.getStateManager().resetToBaseline()
  }

  /**
   * Restart the agent (stop + start).
   */
  public async restart(): Promise<void> {
    await this.stop()
    await this.start()
  }

  /**
   * Start the agent and initialize all services.
   * Must be called before using other methods.
   *
   * @throws AgentError if already started or initialization fails
   */
  public async start(): Promise<void> {
    if (this._isStarted) {
      throw AgentError.alreadyStarted()
    }

    if (this._isStopped) {
      // Reset stopped flag to allow restart
      this._isStopped = false
    }

    try {
      // Initialize services (implemented by subclass)
      const services = await this.initializeServices()

      // Validate required services
      this.validateServices(services)

      // Assign services
      this.services = services

      // Create state manager with the event bus from services
      this.stateManager = new AgentStateManager(this.config, services.agentEventBus)

      this._isStarted = true
    } catch (error) {
      if (error instanceof AgentError) {
        throw error
      }

      throw AgentError.initializationFailed(error instanceof Error ? error.message : String(error), error)
    }
  }

  /**
   * Stop the agent and cleanup all services.
   * After stopping, the agent can be restarted with start().
   */
  public async stop(): Promise<void> {
    if (this._isStopped) {
      return // Already stopped, no-op
    }

    if (!this._isStarted) {
      // Not started, just mark as stopped
      this._isStopped = true
      return
    }

    try {
      // Cleanup services (implemented by subclass)
      await this.cleanupServices()

      // Clear state
      this.services = undefined
      this.stateManager = undefined

      this._isStopped = true
      this._isStarted = false
    } catch (error) {
      // Still mark as stopped even if cleanup fails
      this._isStopped = true
      this._isStarted = false

      throw AgentError.executionFailed(`Failed to stop agent: ${error instanceof Error ? error.message : String(error)}`, error)
    }
  }

  /**
   * Update LLM configuration at runtime.
   *
   * @param updates - Partial LLM configuration updates
   * @param sessionId - Optional session ID for session-specific override
   * @returns Updated LLM configuration
   */
  public updateLLM(updates: LLMUpdates, sessionId?: string): ValidatedLLMConfig {
    this.ensureStarted()

    // Validate updates
    const parseResult = LLMUpdatesSchema.safeParse(updates)
    if (!parseResult.success) {
      throw AgentError.invalidConfig('Invalid LLM updates', parseResult.error.format())
    }

    // Get current config and merge
    const currentConfig = this.getStateManager().getLLMConfig(sessionId)
    const mergedUpdates = {...currentConfig, ...parseResult.data}

    // Update state
    this.getStateManager().updateLLM(mergedUpdates, sessionId)

    return this.getStateManager().getLLMConfig(sessionId)
  }

  /**
   * Validate that all required services are present.
   * Can be overridden by subclasses to add custom validation.
   */
  protected validateServices(services: CipherAgentServices): void {
    const requiredServices: (keyof CipherAgentServices)[] = [
      'agentEventBus',
      'toolManager',
      'systemPromptManager',
      'fileSystemService',
      'processService',
      'historyStorage',
      'memoryManager',
      'blobStorage',
      'policyEngine',
      'toolProvider',
      'toolScheduler',
    ]

    for (const serviceName of requiredServices) {
      if (!services[serviceName]) {
        throw AgentError.missingRequiredService(serviceName)
      }
    }
  }
}
