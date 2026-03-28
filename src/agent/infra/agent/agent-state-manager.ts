import type {TerminationReason} from '../../core/domain/agent/agent-state.js'
import type {AgentExecutionState, AgentState} from '../../core/interfaces/i-cipher-agent.js'
import type {AgentEventBus} from '../events/event-emitter.js'
import type {ValidatedAgentConfig, ValidatedLLMConfig} from './agent-schemas.js'

/**
 * Session-specific overrides that can differ from the global configuration.
 */
export interface SessionOverride {
  llm?: Partial<ValidatedLLMConfig>
}

/**
 * Manages two concerns:
 *
 * 1. Configuration State:
 *    - baselineConfig: Original validated config, never mutated
 *    - runtimeConfig: Current active config, can be mutated
 *    - sessionOverrides: Per-session config overrides
 *
 * 2. Execution State (runtime tracking):
 *    - currentIteration: Turn counter
 *    - executionState: idle | executing | complete | error | aborted | tool_calling
 *    - terminationReason: Why execution ended
 *    - timing: startTime, endTime, durationMs
 *    - toolCallsExecuted: Tool call counter
 *    - executionHistory: Legacy history records
 */
export class AgentStateManager {
  private readonly baselineConfig: ValidatedAgentConfig
  private currentIteration: number = 0
  private durationMs?: number
  private endTime?: Date
  private executionHistory: string[] = []
  private executionState: AgentExecutionState = 'idle'
  private runtimeConfig: ValidatedAgentConfig
  private readonly sessionOverrides: Map<string, SessionOverride> = new Map()
  private startTime?: Date
  private terminationReason?: TerminationReason
  private toolCallsExecuted: number = 0

  constructor(
    staticConfig: ValidatedAgentConfig,
    private readonly agentEventBus: AgentEventBus,
  ) {
    // Deep clone to prevent external mutations
    this.baselineConfig = structuredClone(staticConfig)
    this.runtimeConfig = structuredClone(staticConfig)
  }

  /**
   * Add an execution record to history (legacy method).
   * @param record - Execution record to add
   */
  public addExecutionRecord(record: string): void {
    this.executionHistory.push(record)
  }

  /**
   * Clear session-specific overrides.
   */
  public clearSessionOverride(sessionId: string): void {
    const hadOverride = this.sessionOverrides.has(sessionId)
    this.sessionOverrides.delete(sessionId)

    if (hadOverride) {
      this.agentEventBus.emit('cipher:stateReset', {sessionId})
    }
  }

  /**
   * Mark execution as complete with reason.
   * @param reason - Why execution terminated
   */
  public complete(reason: TerminationReason): void {
    this.executionState = 'complete'
    this.terminationReason = reason
    this.endTime = new Date()
    if (this.startTime) {
      this.durationMs = this.endTime.getTime() - this.startTime.getTime()
    }
  }

  /**
   * Export current runtime state as a config object.
   */
  public exportAsConfig(): ValidatedAgentConfig {
    return structuredClone(this.runtimeConfig)
  }

  /**
   * Mark execution as errored.
   * @param reason - Error termination reason
   */
  public fail(reason: TerminationReason): void {
    this.executionState = 'error'
    this.terminationReason = reason
    this.endTime = new Date()
    if (this.startTime) {
      this.durationMs = this.endTime.getTime() - this.startTime.getTime()
    }
  }

  /**
   * Get the original baseline configuration.
   */
  public getBaselineConfig(): Readonly<ValidatedAgentConfig> {
    return structuredClone(this.baselineConfig)
  }

  /**
   * Get the current execution state.
   * @returns Current agent state with all execution fields
   */
  public getExecutionState(): AgentState {
    return {
      currentIteration: this.currentIteration,
      durationMs: this.durationMs,
      endTime: this.endTime,
      executionHistory: [...this.executionHistory],
      executionState: this.executionState,
      startTime: this.startTime,
      terminationReason: this.terminationReason,
      toolCallsExecuted: this.toolCallsExecuted,
    }
  }

  /**
   * Get effective LLM config for a session.
   */
  public getLLMConfig(sessionId?: string): Readonly<ValidatedLLMConfig> {
    return this.getRuntimeConfig(sessionId).llm
  }

  /**
   * Get the current model identifier.
   */
  public getModel(sessionId?: string): string {
    return this.getRuntimeConfig(sessionId).model
  }

  /**
   * Get runtime configuration for a session (includes session overrides if sessionId provided).
   */
  public getRuntimeConfig(sessionId?: string): Readonly<ValidatedAgentConfig> {
    if (!sessionId) {
      return structuredClone(this.runtimeConfig)
    }

    const override = this.sessionOverrides.get(sessionId)
    if (!override) {
      return structuredClone(this.runtimeConfig)
    }

    // Merge session overrides into runtime config
    return {
      ...this.runtimeConfig,
      llm: {...this.runtimeConfig.llm, ...override.llm},
    }
  }

  /**
   * Get all session IDs that have overrides.
   */
  public getSessionsWithOverrides(): string[] {
    return [...this.sessionOverrides.keys()]
  }

  /**
   * Check if a session has overrides.
   */
  public hasSessionOverride(sessionId: string): boolean {
    return this.sessionOverrides.has(sessionId)
  }

  /**
   * Increment the iteration counter.
   * @returns The new iteration count
   */
  public incrementIteration(): number {
    this.currentIteration++
    return this.currentIteration
  }

  /**
   * Increment the tool calls counter.
   * @returns The new tool calls count
   */
  public incrementToolCalls(): number {
    this.toolCallsExecuted++
    return this.toolCallsExecuted
  }

  /**
   * Reset all state to initial values.
   * Resets both execution state and configuration state.
   */
  public reset(): void {
    // Reset execution state
    this.currentIteration = 0
    this.durationMs = undefined
    this.endTime = undefined
    this.executionHistory = []
    this.executionState = 'idle'
    this.startTime = undefined
    this.terminationReason = undefined
    this.toolCallsExecuted = 0
  }

  /**
   * Reset runtime configuration to baseline.
   * Also clears all session overrides.
   */
  public resetToBaseline(): void {
    this.runtimeConfig = structuredClone(this.baselineConfig)
    this.sessionOverrides.clear()

    this.agentEventBus.emit('cipher:stateReset', {})
  }

  /**
   * Set the current execution state.
   * @param state - New execution state
   */
  public setExecutionState(state: AgentExecutionState): void {
    this.executionState = state
  }

  /**
   * Start execution tracking.
   * Sets startTime and transitions to executing state.
   */
  public startExecution(): void {
    this.startTime = new Date()
    this.executionState = 'executing'
  }

  /**
   * Update LLM configuration globally or for a specific session.
   *
   * @param updates - Partial LLM configuration updates
   * @param sessionId - Optional session ID for session-specific override
   */
  public updateLLM(updates: Partial<ValidatedLLMConfig>, sessionId?: string): void {
    const oldValue = sessionId ? this.getRuntimeConfig(sessionId).llm : this.runtimeConfig.llm

    if (sessionId) {
      // Session-specific override
      this.setSessionOverride(sessionId, {llm: updates})
    } else {
      // Global update
      this.runtimeConfig = {
        ...this.runtimeConfig,
        llm: {...this.runtimeConfig.llm, ...updates},
      }
    }

    const newValue = sessionId ? this.getRuntimeConfig(sessionId).llm : this.runtimeConfig.llm

    this.agentEventBus.emit('cipher:stateChanged', {
      field: 'llm',
      newValue,
      oldValue,
      sessionId,
    })
  }

  /**
   * Update the model globally or for a specific session.
   */
  public updateModel(model: string, sessionId?: string): void {
    const oldValue = this.getModel(sessionId)

    if (sessionId) {
      // For session-specific model change, we need to track it differently
      // since model is at the root level, not in llm config
      // For now, emit state change event
      this.agentEventBus.emit('cipher:stateChanged', {
        field: 'model',
        newValue: model,
        oldValue,
        sessionId,
      })
    } else {
      this.runtimeConfig = {
        ...this.runtimeConfig,
        model,
      }

      this.agentEventBus.emit('cipher:stateChanged', {
        field: 'model',
        newValue: model,
        oldValue,
      })
    }
  }

  /**
   * Set a session-specific override.
   */
  private setSessionOverride(sessionId: string, override: SessionOverride): void {
    const existing = this.sessionOverrides.get(sessionId) ?? {}

    // Merge LLM overrides
    const mergedOverride: SessionOverride = {
      ...existing,
      llm: {...existing.llm, ...override.llm},
    }

    this.sessionOverrides.set(sessionId, mergedOverride)

    this.agentEventBus.emit('cipher:stateChanged', {
      field: 'sessionOverride',
      newValue: structuredClone(mergedOverride),
      sessionId,
    })
  }
}
