import {randomUUID} from 'node:crypto'

import type {BrvConfig} from '../../../core/domain/entities/brv-config.js'
import type {Execution} from '../storage/agent-storage.js'

import {getCurrentConfig} from '../../../config/environment.js'
import {PROJECT} from '../../../constants.js'
import {CipherAgent} from '../cipher-agent.js'
import {closeAgentStorage, getAgentStorage, getAgentStorageSync} from '../storage/agent-storage.js'

// Heartbeat interval for consumer liveness detection (10 seconds)
const HEARTBEAT_INTERVAL_MS = 1000
// Consumer is considered stale after 5 seconds without heartbeat
const STALE_TIMEOUT_MS = 5000

// Check for orphaned executions every N poll cycles (10 seconds with 1s poll interval)
const ORPHAN_CHECK_INTERVAL_CYCLES = 10

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * Create args summary for display
 */
function createArgsSummary(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'Bash': {
      return String(args.command ?? '').slice(0, 50)
    }

    case 'Edit': {
      return `${args.file_path ?? ''}`
    }

    case 'Grep': {
      return `"${args.pattern ?? ''}" in ${args.path ?? '.'}`
    }

    case 'Read': {
      return String(args.file_path ?? '')
    }

    case 'Write': {
      return String(args.file_path ?? '')
    }

    default: {
      return JSON.stringify(args).slice(0, 50)
    }
  }
}

/**
 * Create result summary for display
 */
function createResultSummary(result: unknown): string {
  if (typeof result !== 'string') {
    return ''
  }

  const lines = result.split('\n').length
  const chars = result.length
  return `${lines} lines, ${chars} chars`
}

/**
 * Extract file path from tool args
 */
function extractFilePath(toolName: string, args: Record<string, unknown>): string | undefined {
  switch (toolName) {
    case 'Edit':
    case 'Read':
    case 'Write': {
      return typeof args.file_path === 'string' ? args.file_path : undefined
    }

    case 'Glob': {
      return typeof args.path === 'string' ? args.path : undefined
    }

    case 'Grep': {
      return typeof args.path === 'string' ? args.path : undefined
    }

    default: {
      return undefined
    }
  }
}

/**
 * Calculate lines and chars count from result
 */
function calculateMetrics(result: unknown): undefined | {charsCount: number; linesCount: number} {
  if (typeof result !== 'string' || result.length === 0) {
    return undefined
  }

  return {
    charsCount: result.length,
    linesCount: result.split('\n').length,
  }
}

/**
 * Parsed curate input from execution
 */
interface CurateInput {
  content: string
  flags?: {
    apiKey?: string
    model?: string
    verbose?: boolean
  }
}

/**
 * ExecutionConsumer - Polls queue and executes jobs in parallel
 *
 * Features:
 * - DB-based lock with heartbeat (detects dead consumers)
 * - Poll loop every 1 second
 * - Parallel processing with configurable concurrency (default 5)
 * - Process curate executions
 * - Track tool calls to database
 * - Cleanup old executions periodically
 */
export class ExecutionConsumer {
  private readonly activeJobs = new Set<string>() // Track running execution IDs
  private authToken?: {accessToken: string; sessionKey: string}
  private readonly brvConfig?: BrvConfig
  private readonly consumerId: string // Unique ID for this consumer instance
  private heartbeatInterval?: ReturnType<typeof setInterval>
  private readonly maxConcurrency: number
  private readonly pollInterval: number
  private running = false

  constructor(options?: {
    authToken?: {accessToken: string; sessionKey: string}
    brvConfig?: BrvConfig
    maxConcurrency?: number
    pollInterval?: number
  }) {
    this.brvConfig = options?.brvConfig
    this.authToken = options?.authToken
    this.maxConcurrency = options?.maxConcurrency ?? 5 // Default 5 concurrent jobs
    this.pollInterval = options?.pollInterval ?? 1000 // 1 second default
    this.consumerId = randomUUID() // Generate unique consumer ID
  }

  /**
   * Check if consumer is running
   */
  isRunning(): boolean {
    return this.running
  }

  /**
   * Set auth token (can be set after construction)
   */
  setAuthToken(token: {accessToken: string; sessionKey: string}): void {
    this.authToken = token
  }

  /**
   * Start the consumer
   * @returns true if started successfully, false if another consumer is running
   */
  async start(): Promise<boolean> {
    // Initialize storage (auto-detects .brv/blobs from cwd)
    const storage = await getAgentStorage()

    // Cleanup stale consumers and orphan their executions
    const orphaned = storage.cleanupStaleConsumers(STALE_TIMEOUT_MS)
    if (orphaned > 0) {
      console.log(`[Consumer] Cleaned up ${orphaned} orphaned executions from dead consumers`)
    }

    // Try acquire DB-based lock
    if (!storage.acquireConsumerLock(this.consumerId)) {
      console.log('[Consumer] Failed to acquire consumer lock')
      return false
    }

    // Register cleanup handlers - must be arrow fn to capture 'this'
    // eslint-disable-next-line unicorn/consistent-function-scoping
    const cleanup = (): void => {
      this.stop()
      closeAgentStorage()
    }

    process.on('exit', cleanup)
    process.on('SIGTERM', () => {
      cleanup()
      // eslint-disable-next-line n/no-process-exit
      process.exit(0)
    })
    process.on('SIGINT', () => {
      cleanup()
      // eslint-disable-next-line n/no-process-exit
      process.exit(0)
    })

    this.running = true

    // Start heartbeat to keep lock alive
    this.heartbeatInterval = setInterval(() => {
      try {
        storage.updateConsumerHeartbeat(this.consumerId)
      } catch (error) {
        console.error('[Consumer] Heartbeat error:', error)
      }
    }, HEARTBEAT_INTERVAL_MS)

    // Log initial queue status
    const queued = storage.getQueuedExecutions()
    const running = storage.getRunningExecutions()
    console.log(
      `[Consumer] Started (${this.consumerId.slice(0, 8)}). Concurrency: ${this.maxConcurrency}, Queue: ${
        queued.length
      } pending, ${running.length} running`,
    )

    // Start poll loop (fire and forget)
    this.poll().catch((error) => {
      console.error('[Consumer] Poll error:', error)
      this.stop()
    })

    return true
  }

  /**
   * Stop the consumer
   */
  stop(): void {
    this.running = false

    // Stop heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = undefined
    }

    // Release DB lock
    try {
      const storage = getAgentStorageSync()
      storage.releaseConsumerLock(this.consumerId)
    } catch {
      // Ignore errors during shutdown
    }

    console.log(`[Consumer] Stopped (${this.consumerId.slice(0, 8)})`)
  }

  /**
   * Execute a curate job
   */
  private async executeCurate(execution: Execution): Promise<void> {
    const storage = getAgentStorageSync()

    // Parse input
    let input: CurateInput
    try {
      input = JSON.parse(execution.input) as CurateInput
    } catch {
      throw new Error('Invalid curate input: failed to parse JSON')
    }

    if (!input.content) {
      throw new Error('Invalid curate input: missing content')
    }

    // Check auth token
    if (!this.authToken) {
      throw new Error('No auth token available. Consumer needs authentication.')
    }

    // Create LLM config
    const model = input.flags?.model ?? (input.flags?.apiKey ? 'google/gemini-2.5-pro' : 'gemini-2.5-pro')
    const envConfig = getCurrentConfig()

    const llmConfig = {
      accessToken: this.authToken.accessToken,
      fileSystemConfig: {workingDirectory: process.cwd()},
      grpcEndpoint: envConfig.llmGrpcEndpoint,
      maxIterations: 10,
      maxTokens: 8192,
      model,
      openRouterApiKey: input.flags?.apiKey,
      projectId: PROJECT,
      sessionKey: this.authToken.sessionKey,
      teamId: this.brvConfig?.teamId ?? '',
      temperature: 0.7,
      verbose: input.flags?.verbose ?? false,
    }

    // Create and start CipherAgent
    const agent = new CipherAgent(llmConfig, this.brvConfig)
    await agent.start()

    try {
      const sessionId = randomUUID()

      // Setup event listeners for tool call tracking
      this.setupToolCallTracking(agent, execution.id)

      // Execute with autonomous mode
      const prompt = `Add the following context to the context tree:\n\n${input.content}`
      const response = await agent.execute(prompt, sessionId, {
        executionContext: {commandType: 'curate'},
        mode: 'autonomous',
      })

      // Mark completed
      storage.updateExecutionStatus(execution.id, 'completed', response)
      console.log(`[Consumer] Execution ${execution.id} completed`)
    } finally {
      // Agent cleanup (if needed in future)
    }
  }

  /**
   * Log execution start (extracted to reduce nesting depth)
   */
  private logExecutionStart(execution: Execution): void {
    try {
      const input = JSON.parse(execution.input) as {content?: string}
      const content = input.content ?? ''
      const preview = content.slice(0, 100).replaceAll('\n', ' ')
      console.log(
        `[Consumer] Starting (${this.activeJobs.size}/${this.maxConcurrency}): "${preview}${
          content.length > 100 ? '...' : ''
        }"`,
      )
    } catch {
      console.log(`[Consumer] Starting (${this.activeJobs.size}/${this.maxConcurrency}): ${execution.id}`)
    }
  }

  /**
   * Main poll loop - dequeues and processes jobs in parallel up to maxConcurrency
   */
  private async poll(): Promise<void> {
    const storage = getAgentStorageSync()
    let cleanupCounter = 0
    let orphanCheckCounter = 0

    while (this.running) {
      try {
        // Calculate available slots
        const availableSlots = this.maxConcurrency - this.activeJobs.size

        // Dequeue batch of jobs atomically (ensures all queued items are seen in one transaction)
        if (availableSlots > 0) {
          const executions = storage.dequeueBatch(availableSlots, this.consumerId)

          for (const execution of executions) {
            // Track this job
            this.activeJobs.add(execution.id)

            // Log execution start
            this.logExecutionStart(execution)

            // Process in background (fire and forget with completion tracking)
            this.processExecutionAsync(execution)
          }
        }

        // Periodic orphan detection - check for dead consumers and fail their executions
        orphanCheckCounter++
        if (orphanCheckCounter >= ORPHAN_CHECK_INTERVAL_CYCLES) {
          orphanCheckCounter = 0
          const orphaned = storage.cleanupStaleConsumers(STALE_TIMEOUT_MS)
          if (orphaned > 0) {
            console.log(`[Consumer] Detected ${orphaned} orphaned executions from dead consumers`)
          }
        }

        // Periodic cleanup (every 10 poll cycles when idle)
        cleanupCounter++
        if (cleanupCounter >= 10 && this.activeJobs.size === 0) {
          cleanupCounter = 0
          const cleaned = storage.cleanupOldExecutions(100)
          if (cleaned > 0) {
            console.log(`[Consumer] Cleaned up ${cleaned} old executions`)
          }
        }
      } catch (error) {
        console.error('[Consumer] Poll error:', error)
      }

      // eslint-disable-next-line no-await-in-loop
      await sleep(this.pollInterval)
    }
  }

  /**
   * Process a single execution
   */
  private async processExecution(execution: Execution): Promise<void> {
    const storage = getAgentStorageSync()

    try {
      switch (execution.type) {
        case 'curate': {
          await this.executeCurate(execution)
          break
        }

        case 'query': {
          // Query should not be in queue (runs sync)
          console.warn(`[Consumer] Query execution ${execution.id} found in queue, marking failed`)
          storage.updateExecutionStatus(execution.id, 'failed', undefined, 'Query should not be queued')
          break
        }

        default: {
          storage.updateExecutionStatus(execution.id, 'failed', undefined, `Unknown execution type: ${execution.type}`)
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`[Consumer] Execution ${execution.id} failed:`, errorMessage)
      storage.updateExecutionStatus(execution.id, 'failed', undefined, errorMessage)
    }
  }

  /**
   * Process execution asynchronously (fire and forget with tracking)
   */
  private processExecutionAsync(execution: Execution): void {
    const storage = getAgentStorageSync()

    this.processExecution(execution)
      .then(() => {
        // Log completion
        const updated = storage.getExecution(execution.id)
        if (updated?.status === 'completed') {
          const resultPreview = (updated.result ?? '').slice(0, 100).replaceAll('\n', ' ')
          console.log(
            `[Consumer] ✓ Done (${this.activeJobs.size - 1}/${this.maxConcurrency}): "${resultPreview}${
              (updated.result?.length ?? 0) > 100 ? '...' : ''
            }"`,
          )
        }
      })
      .catch((error) => {
        console.error(`[Consumer] ✗ Failed: ${error instanceof Error ? error.message : String(error)}`)
      })
      .finally(() => {
        // Remove from active jobs
        this.activeJobs.delete(execution.id)

        // Log queue status
        const queued = storage.getQueuedExecutions()
        if (queued.length > 0 || this.activeJobs.size > 0) {
          console.log(`[Consumer] Status: ${this.activeJobs.size} running, ${queued.length} queued`)
        }

        // Immediately try to pick up more jobs (don't wait for next poll cycle)
        if (this.running && queued.length > 0) {
          this.tryPickupJobs()
        }
      })
  }

  /**
   * Setup tool call tracking via event listeners
   */
  private setupToolCallTracking(agent: CipherAgent, executionId: string): void {
    if (!agent.agentEventBus) {
      console.warn('[Consumer] Agent event bus not available, tool call tracking disabled')
      return
    }

    const storage = getAgentStorageSync()
    const eventBus = agent.agentEventBus
    const toolCallMap = new Map<string, string>() // callId -> dbToolCallId

    eventBus.on('llmservice:toolCall', (payload) => {
      try {
        if (!payload.callId) return
        const toolCallId = storage.addToolCall(executionId, {
          args: payload.args,
          argsSummary: createArgsSummary(payload.toolName, payload.args),
          filePath: extractFilePath(payload.toolName, payload.args),
          name: payload.toolName,
        })
        toolCallMap.set(payload.callId, toolCallId)
      } catch (error) {
        console.error('[Consumer] Failed to add tool call:', error)
      }
    })

    eventBus.on('llmservice:toolResult', (payload) => {
      try {
        if (!payload.callId) return
        const toolCallId = toolCallMap.get(payload.callId)
        if (toolCallId) {
          const resultStr = typeof payload.result === 'string' ? payload.result : JSON.stringify(payload.result)
          const metrics = calculateMetrics(payload.result)

          storage.updateToolCall(toolCallId, payload.success ? 'completed' : 'failed', {
            charsCount: metrics?.charsCount,
            error: payload.error,
            linesCount: metrics?.linesCount,
            result: resultStr,
            resultSummary: createResultSummary(payload.result),
          })
        }
      } catch (error) {
        console.error('[Consumer] Failed to update tool call:', error)
      }
    })
  }

  /**
   * Try to pick up queued jobs (called after job completion)
   */
  private tryPickupJobs(): void {
    const storage = getAgentStorageSync()
    const availableSlots = this.maxConcurrency - this.activeJobs.size

    if (availableSlots <= 0) return

    // Dequeue batch atomically
    const executions = storage.dequeueBatch(availableSlots, this.consumerId)

    for (const execution of executions) {
      this.activeJobs.add(execution.id)

      try {
        const input = JSON.parse(execution.input) as {content?: string}
        const content = input.content ?? ''
        const preview = content.slice(0, 100).replaceAll('\n', ' ')
        console.log(
          `[Consumer] Starting (${this.activeJobs.size}/${this.maxConcurrency}): "${preview}${
            content.length > 100 ? '...' : ''
          }"`,
        )
      } catch {
        console.log(`[Consumer] Starting (${this.activeJobs.size}/${this.maxConcurrency}): ${execution.id}`)
      }

      this.processExecutionAsync(execution)
    }
  }
}

// ==================== FACTORY & SINGLETON ====================

let consumerInstance: ExecutionConsumer | null = null

/**
 * Create a new ExecutionConsumer instance
 */
export function createExecutionConsumer(options?: {
  authToken?: {accessToken: string; sessionKey: string}
  brvConfig?: BrvConfig
  maxConcurrency?: number
  pollInterval?: number
}): ExecutionConsumer {
  return new ExecutionConsumer(options)
}

/**
 * Try to start a consumer (singleton pattern)
 * Returns the consumer instance if started, null if already running
 */
export async function tryStartConsumer(options?: {
  authToken?: {accessToken: string; sessionKey: string}
  brvConfig?: BrvConfig
  maxConcurrency?: number
  pollInterval?: number
}): Promise<ExecutionConsumer | null> {
  // If we already have a running consumer, return null
  if (consumerInstance?.isRunning()) {
    return null
  }

  const consumer = createExecutionConsumer(options)
  const started = await consumer.start()

  if (started) {
    consumerInstance = consumer
    return consumer
  }

  return null
}

/**
 * Get the current consumer instance (if running)
 */
export function getConsumer(): ExecutionConsumer | null {
  return consumerInstance?.isRunning() ? consumerInstance : null
}

/**
 * Stop the current consumer
 */
export function stopConsumer(): void {
  if (consumerInstance) {
    consumerInstance.stop()
    consumerInstance = null
  }
}
