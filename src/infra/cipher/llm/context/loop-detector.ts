/**
 * Loop Detector for Agent Tool Calls
 *
 * Detects repetitive tool call patterns to prevent the agent from:
 * - Making the same tool call with identical arguments multiple times
 * - Oscillating between two tool calls (A→B→A→B pattern)
 *
 * When a loop is detected, the caller should skip tool execution
 * and inject a warning message to guide the LLM to try a different approach.
 */

/**
 * Signature of a tool call for comparison.
 */
export interface ToolCallSignature {
  /** Hash of the serialized arguments for fast comparison */
  argsHash: string
  /** Timestamp when the call was recorded */
  timestamp: number
  /** Name of the tool being called */
  toolName: string
}

/**
 * Result of loop detection check.
 */
export interface LoopDetectionResult {
  /** Whether a loop pattern was detected */
  isLoop: boolean
  /** Type of loop pattern detected */
  loopType?: 'exact_repeat' | 'oscillation'
  /** Number of times the pattern repeated */
  repeatCount?: number
  /** Human-readable suggestion for the LLM */
  suggestion?: string
}

/**
 * Configuration for loop detection thresholds.
 */
export interface LoopDetectorConfig {
  /** Same tool+args called N times consecutively = loop (default: 3) */
  exactRepeatThreshold: number
  /** A→B→A→B pattern cycles before detection (default: 2) */
  oscillationThreshold: number
  /** How many recent calls to track (default: 10) */
  windowSize: number
}

/**
 * Default configuration values.
 */
const DEFAULT_CONFIG: LoopDetectorConfig = {
  exactRepeatThreshold: 3,
  oscillationThreshold: 2,
  windowSize: 10,
}

/**
 * Loop Detector.
 *
 * Tracks recent tool calls and detects repetitive patterns.
 * This helps prevent the agent from wasting tokens and time
 * on repeated unsuccessful attempts.
 *
 * @example
 * ```typescript
 * const detector = new LoopDetector()
 *
 * // Before executing each tool call
 * const result = detector.recordAndCheck('read_file', { path: '/foo.ts' })
 * if (result.isLoop) {
 *   // Skip execution, inject warning to LLM
 *   console.log(result.suggestion)
 * } else {
 *   // Execute tool normally
 * }
 * ```
 */
export class LoopDetector {
  private readonly config: LoopDetectorConfig
  private recentCalls: ToolCallSignature[] = []

  constructor(config: Partial<LoopDetectorConfig> = {}) {
    this.config = {...DEFAULT_CONFIG, ...config}
  }

  /**
   * Get the current configuration.
   */
  getConfig(): Readonly<LoopDetectorConfig> {
    return {...this.config}
  }

  /**
   * Get the number of recorded calls in the window.
   */
  getRecentCallCount(): number {
    return this.recentCalls.length
  }

  /**
   * Record a tool call and check for loop patterns.
   *
   * @param toolName - Name of the tool being called
   * @param args - Arguments passed to the tool
   * @returns Detection result indicating if a loop was found
   */
  recordAndCheck(toolName: string, args: Record<string, unknown>): LoopDetectionResult {
    const signature = this.createSignature(toolName, args)
    this.recentCalls.push(signature)

    // Trim to window size
    if (this.recentCalls.length > this.config.windowSize) {
      this.recentCalls.shift()
    }

    return this.detectLoop()
  }

  /**
   * Reset the detector state.
   * Should be called when starting a new conversation or task.
   */
  reset(): void {
    this.recentCalls = []
  }

  /**
   * Create a signature for a tool call.
   */
  private createSignature(toolName: string, args: Record<string, unknown>): ToolCallSignature {
    return {
      argsHash: this.hashArgs(args),
      timestamp: Date.now(),
      toolName,
    }
  }

  /**
   * Detect exact repeat pattern: same call N times consecutively.
   */
  private detectExactRepeat(): LoopDetectionResult {
    if (this.recentCalls.length < this.config.exactRepeatThreshold) {
      return {isLoop: false}
    }

    const lastCall = this.recentCalls.at(-1)
    if (!lastCall) {
      return {isLoop: false}
    }

    let repeatCount = 1

    // Count consecutive identical calls from the end
    for (let i = this.recentCalls.length - 2; i >= 0; i--) {
      if (this.signaturesMatch(this.recentCalls[i], lastCall)) {
        repeatCount++
      } else {
        break
      }
    }

    if (repeatCount >= this.config.exactRepeatThreshold) {
      return {
        isLoop: true,
        loopType: 'exact_repeat',
        repeatCount,
        suggestion: `Tool "${lastCall.toolName}" has been called ${repeatCount} times with the same arguments. This indicates a loop. Please try a different approach to accomplish your goal.`,
      }
    }

    return {isLoop: false}
  }

  /**
   * Detect loop patterns in recent calls.
   */
  private detectLoop(): LoopDetectionResult {
    // Pattern 1: Exact repeat (same tool+args N times in a row)
    const exactRepeat = this.detectExactRepeat()
    if (exactRepeat.isLoop) {
      return exactRepeat
    }

    // Pattern 2: Oscillation (A→B→A→B)
    const oscillation = this.detectOscillation()
    if (oscillation.isLoop) {
      return oscillation
    }

    return {isLoop: false}
  }

  /**
   * Detect oscillation pattern: A→B→A→B.
   */
  private detectOscillation(): LoopDetectionResult {
    // Need at least 4 calls for one oscillation cycle (A→B→A→B)
    const minCalls = this.config.oscillationThreshold * 2
    if (this.recentCalls.length < minCalls) {
      return {isLoop: false}
    }

    // Check for A→B→A→B pattern in the last 4 calls
    const calls = this.recentCalls.slice(-4)

    // A[0] == A[2] and B[1] == B[3] and A[0] != B[1]
    if (
      this.signaturesMatch(calls[0], calls[2]) &&
      this.signaturesMatch(calls[1], calls[3]) &&
      !this.signaturesMatch(calls[0], calls[1])
    ) {
      return {
        isLoop: true,
        loopType: 'oscillation',
        repeatCount: 2,
        suggestion: `Detected oscillation pattern between "${calls[0].toolName}" and "${calls[1].toolName}". The agent is alternating between these two tools without making progress. Please try a different strategy.`,
      }
    }

    return {isLoop: false}
  }

  /**
   * Create a deterministic hash of tool arguments.
   * Sorts keys to ensure consistent ordering.
   */
  private hashArgs(args: Record<string, unknown>): string {
    // Sort keys for deterministic serialization
    const sortedKeys = Object.keys(args).sort()
    const sortedArgs: Record<string, unknown> = {}
    for (const key of sortedKeys) {
      sortedArgs[key] = args[key]
    }

    return JSON.stringify(sortedArgs)
  }

  /**
   * Check if two signatures represent the same tool call.
   */
  private signaturesMatch(a: ToolCallSignature, b: ToolCallSignature): boolean {
    return a.toolName === b.toolName && a.argsHash === b.argsHash
  }
}
