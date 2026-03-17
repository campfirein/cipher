import type {SessionEventBus} from '../../events/event-emitter.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Snapshot of accumulated session progress data.
 * Consumed by ProgressTrajectoryContributor to render a compact summary.
 */
export interface ProgressSnapshot {
  /** Number of times context was compressed (strategy-chain + summary-compaction). */
  compressionCount: number

  /** Number of doom loop detections. */
  doomLoopCount: number

  /** Number of LLM errors. */
  errorCount: number

  /** Number of completed agentic iterations. */
  iterationCount: number

  /** Recent token utilization percentages (rolling window). */
  tokenUtilizationHistory: number[]

  /** Total tool calls (success + failure). */
  toolCallCount: number

  /** Tool calls that failed. */
  toolFailureCount: number

  /** Tool calls that succeeded. */
  toolSuccessCount: number

  /** Top N tools by call count. */
  topTools: Array<{count: number; name: string}>
}

export interface SessionProgressTrackerOptions {
  /** Maximum utilization history entries to keep (default: 10). */
  maxUtilizationHistory?: number

  /** Maximum top tools to report (default: 5). */
  topToolsLimit?: number
}

// ---------------------------------------------------------------------------
// SessionProgressTracker
// ---------------------------------------------------------------------------

/**
 * Tracks session-level progress metrics by subscribing to SessionEventBus events.
 *
 * Provides a frozen snapshot of accumulated progress data that the
 * ProgressTrajectoryContributor can render into a compact system prompt section.
 *
 * Designed for a single session lifecycle — create, attach, use, detach.
 */
export class SessionProgressTracker {
  private readonly abortController = new AbortController()
  private compressionCount = 0
  private doomLoopCount = 0
  private errorCount = 0
  private iterationCount = 0
  private readonly maxUtilizationHistory: number
  private readonly sessionEventBus: SessionEventBus
  private readonly toolCounts = new Map<string, number>()
  private toolFailureCount = 0
  private toolSuccessCount = 0
  private readonly topToolsLimit: number
  private readonly utilizationHistory: number[] = []

  constructor(sessionEventBus: SessionEventBus, options?: SessionProgressTrackerOptions) {
    this.sessionEventBus = sessionEventBus
    this.maxUtilizationHistory = options?.maxUtilizationHistory ?? 10
    this.topToolsLimit = options?.topToolsLimit ?? 5
  }

  /**
   * Start listening to session events.
   * Call once after construction. Safe to call multiple times (idempotent via AbortSignal).
   */
  public attach(): void {
    const {signal} = this.abortController

    // Tool results — track success/failure and per-tool counts
    this.sessionEventBus.on(
      'llmservice:toolResult',
      (payload) => {
        const {toolName} = (payload as {toolName?: string})
        if (toolName) {
          this.toolCounts.set(toolName, (this.toolCounts.get(toolName) ?? 0) + 1)
        }

        if ((payload as {success?: boolean}).success) {
          this.toolSuccessCount++
        } else {
          this.toolFailureCount++
        }
      },
      {signal},
    )

    // Context overflow — carries utilizationPercent
    this.sessionEventBus.on(
      'llmservice:contextOverflow',
      (payload) => {
        const percent = (payload as {utilizationPercent?: number}).utilizationPercent
        if (typeof percent === 'number') {
          this.utilizationHistory.push(percent)
          if (this.utilizationHistory.length > this.maxUtilizationHistory) {
            this.utilizationHistory.shift()
          }
        }
      },
      {signal},
    )

    // Compression quality — emitted by Pattern 4 after full strategy chain
    this.sessionEventBus.on(
      'llmservice:compressionQuality',
      () => {
        this.compressionCount++
      },
      {signal},
    )

    // Context compressed — emitted by summary-compaction path
    this.sessionEventBus.on(
      'llmservice:contextCompressed',
      () => {
        this.compressionCount++
      },
      {signal},
    )

    // Doom loop detection
    this.sessionEventBus.on(
      'llmservice:doomLoopDetected',
      () => {
        this.doomLoopCount++
      },
      {signal},
    )

    // LLM errors
    this.sessionEventBus.on(
      'llmservice:error',
      () => {
        this.errorCount++
      },
      {signal},
    )
  }

  /**
   * Stop listening to all session events.
   * Safe to call multiple times.
   */
  public detach(): void {
    this.abortController.abort()
  }

  /**
   * Return a frozen snapshot of accumulated progress data.
   */
  public getSnapshot(): ProgressSnapshot {
    // Build top tools sorted by count descending
    const topTools = [...this.toolCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, this.topToolsLimit)
      .map(([name, count]) => ({count, name}))

    return {
      compressionCount: this.compressionCount,
      doomLoopCount: this.doomLoopCount,
      errorCount: this.errorCount,
      iterationCount: this.iterationCount,
      tokenUtilizationHistory: [...this.utilizationHistory],
      toolCallCount: this.toolSuccessCount + this.toolFailureCount,
      toolFailureCount: this.toolFailureCount,
      toolSuccessCount: this.toolSuccessCount,
      topTools,
    }
  }

  /**
   * Record a completed agentic iteration.
   * Called by AgentLLMService after each successful executeAgenticIteration().
   */
  public recordIteration(): void {
    this.iterationCount++
  }
}
