import type {LaneBudgets} from './memory-types.js'

/**
 * Configuration for NCLMCore iteration loop.
 */
export interface NCLMCoreConfig {
  /** Current recursion depth (internal, default 0) */
  depth?: number
  /** Lane budgets for memory injection into system prompt */
  injectionBudgets?: LaneBudgets
  /** Max recursion depth (default 2) */
  maxDepth?: number
  /** Max consecutive errors before stopping (default 3) */
  maxErrors?: number
  /** Max iterations per completion (default 10) */
  maxIterations?: number
  /** Max time in ms */
  maxTimeout?: number
  /** Max total tokens */
  maxTokens?: number
  /** Keep memory across completion() calls (default true) */
  persistent?: boolean
}

/**
 * Internal state tracked during a completion run.
 */
export interface NCLMState {
  bestPartialAnswer: null | string
  cumulativeTokens: {input: number; output: number}
  errorCount: number
  iterationCount: number
  messageHistory: Array<{content: string; role: 'assistant' | 'system' | 'user'}>
  startTime: number
}

/**
 * Result of a completed NCLM run.
 */
export interface NCLMCompletion {
  executionTime: number
  iterations: number
  response: string
  usage: {inputTokens: number; outputTokens: number}
}

/**
 * Custom errors for resource limit violations.
 */
export class NCLMTimeoutError extends Error {
  constructor(public readonly partialAnswer: null | string) {
    super('NCLM timeout exceeded')
    this.name = 'NCLMTimeoutError'
  }
}

export class NCLMTokenLimitError extends Error {
  constructor(public readonly partialAnswer: null | string) {
    super('NCLM token limit exceeded')
    this.name = 'NCLMTokenLimitError'
  }
}

export class NCLMErrorThresholdError extends Error {
  constructor(public readonly partialAnswer: null | string) {
    super('NCLM consecutive error threshold exceeded')
    this.name = 'NCLMErrorThresholdError'
  }
}
