/**
 * Agent State Machine - Single source of truth for agent lifecycle state.
 *
 * Replaces multiple boolean flags (isInitializing, isAgentInitialized, etc.)
 * with a single state machine that enforces valid transitions.
 *
 * Benefits:
 * - No contradictory states possible (e.g., initializing AND ready)
 * - Clear state transitions with logging
 * - Easy to debug and reason about
 */

import {agentLog} from '../../utils/process-logger.js'

/**
 * Agent lifecycle states.
 *
 * State diagram:
 * ```
 *                    ┌─────────────────────────────────────┐
 *                    │                                     │
 *                    v                                     │
 *   idle ──────> initializing ──────> ready ──────> reinitializing
 *     │              │                  │                  │
 *     │              │ (fail)           │                  │ (fail)
 *     │              v                  │                  v
 *     │           idle <────────────────┼──────────────  idle
 *     │                                 │
 *     │                                 v
 *     └─────────────────────────────> stopping ──────> stopped
 * ```
 */
export type AgentState =
  | 'idle' // Not started or init failed
  | 'initializing' // Starting up
  | 'ready' // Fully operational
  | 'reinitializing' // Restarting with new config
  | 'stopped' // Terminated (terminal state)
  | 'stopping' // Shutting down

/**
 * Valid state transitions.
 * Only these transitions are allowed.
 */
const VALID_TRANSITIONS: Record<AgentState, AgentState[]> = {
  idle: ['initializing', 'stopped'],
  initializing: ['ready', 'idle', 'stopped'], // idle = init failed
  ready: ['reinitializing', 'stopping'],
  reinitializing: ['ready', 'idle', 'stopping'], // idle = reinit failed
  stopped: [], // terminal - no transitions allowed
  stopping: ['stopped'],
}

/** Current state */
let currentState: AgentState = 'idle'

/**
 * Get current agent state.
 */
export function getAgentState(): AgentState {
  return currentState
}

/**
 * Check if transition to new state is valid.
 */
export function canTransitionTo(newState: AgentState): boolean {
  return VALID_TRANSITIONS[currentState].includes(newState)
}

/**
 * Transition to new state.
 * Logs the transition and returns false if invalid.
 */
export function transitionTo(newState: AgentState): boolean {
  if (!canTransitionTo(newState)) {
    agentLog(`Invalid state transition: ${currentState} -> ${newState}`)
    return false
  }

  const oldState = currentState
  currentState = newState
  agentLog(`State transition: ${oldState} -> ${newState}`)
  return true
}

/**
 * Force state to a specific value (for testing/reset only).
 * @internal
 */
export function resetState(state: AgentState = 'idle'): void {
  currentState = state
}

// ============================================================================
// Helper Predicates
// ============================================================================

/**
 * Check if agent is fully initialized and ready.
 */
export function isReady(): boolean {
  return currentState === 'ready'
}

/**
 * Check if agent can accept new tasks.
 * Only ready state can accept tasks.
 */
export function canAcceptTasks(): boolean {
  return currentState === 'ready'
}

/**
 * Check if agent can start initialization.
 * Can init from idle (first start) or ready (reinit).
 */
export function canStartInit(): boolean {
  return currentState === 'idle'
}

/**
 * Check if agent can start reinitialization.
 * Can reinit only from ready state.
 */
export function canStartReinit(): boolean {
  return currentState === 'ready'
}

/**
 * Check if agent is in a transitional state.
 */
export function isTransitioning(): boolean {
  return currentState === 'initializing' || currentState === 'reinitializing' || currentState === 'stopping'
}

/**
 * Check if agent is stopped or stopping.
 */
export function isStopped(): boolean {
  return currentState === 'stopped' || currentState === 'stopping'
}

/**
 * Check if agent is currently polling credentials.
 * Note: This is separate from state machine - polling happens during 'ready' state.
 */
let isPollingCredentials = false

export function setPolling(polling: boolean): void {
  isPollingCredentials = polling
}

export function isPolling(): boolean {
  return isPollingCredentials
}
