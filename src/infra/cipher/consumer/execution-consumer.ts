// TODO(v0.5.0): Remove this file. ExecutionConsumer is replaced by TaskProcessor.

import {randomUUID} from 'node:crypto'

import type {BrvConfig} from '../../../core/domain/entities/brv-config.js'
import type {Execution} from '../storage/agent-storage.js'

import {getCurrentConfig} from '../../../config/environment.js'
import {PROJECT} from '../../../constants.js'
import {CipherAgent} from '../agent/index.js'
import {AgentStorage, closeAgentStorage, getAgentStorage, getAgentStorageSync} from '../storage/agent-storage.js'

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
  fileReferenceInstructions?: string
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
   * Get the unique consumer ID for this instance
   */
  getConsumerId(): string {
    return this.consumerId
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

    // Register cleanup handlers
    // eslint-disable-next-line unicorn/consistent-function-scoping
    const cleanup = (): void => {
      this.stop()
      closeAgentStorage()
    }

    // Use 'once' to prevent multiple handler calls
    // 'exit' is always fired, so just cleanup (no need for process.exit)
    process.once('exit', cleanup)
    process.once('SIGTERM', () => {
      cleanup()
      // eslint-disable-next-line n/no-process-exit
      process.exit(0)
    })
    process.once('SIGINT', () => {
      cleanup()
      // eslint-disable-next-line n/no-process-exit
      process.exit(0)
    })

    this.running = true

    // Start heartbeat to keep lock alive
    this.heartbeatInterval = setInterval(() => {
      try {
        // Note: DB reconnect is handled in poll() loop
        // Heartbeat just updates if lock exists, poll() handles reconnection
        const currentStorage = getAgentStorageSync()
        currentStorage.updateConsumerHeartbeat(this.consumerId)
      } catch {
        // Ignore heartbeat errors - poll() will handle reconnection
        // This prevents noisy errors when DB is being replaced
      }
    }, HEARTBEAT_INTERVAL_MS)

    // Log initial queue status
    // const queued = storage.getQueuedExecutions()
    // const running = storage.getRunningExecutions()
    // console.log(
    //   `[Consumer] Started (${this.consumerId.slice(0, 8)}). Concurrency: ${this.maxConcurrency}, Queue: ${
    //     queued.length
    //   } pending, ${running.length} running`,
    // )

    // Start poll loop (fire and forget)
    this.poll().catch((error) => {
      console.error('[Consumer] Poll error:', error)
      this.stop()
    })

    return true
  }

  /**
   * Stop the consumer
   * Idempotent - safe to call multiple times (only runs cleanup once)
   */
  stop(): void {
    // Guard: Only run cleanup once
    if (!this.running && !this.heartbeatInterval) {
      return // Already stopped
    }

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

    // console.log(`[Consumer] Stopped (${this.consumerId.slice(0, 8)})`)
  }

  /**
   * Execute a curate job using the Plan Agent for orchestration.
   *
   * The Plan Agent orchestrates the curation workflow by:
   * 1. Analyzing the user's request
   * 2. Delegating to Query subagent to find existing context
   * 3. Delegating to Curate subagent to create/update topics
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

    // Create LLM config with Plan Agent settings
    // Plan Agent has read-only permissions and orchestrates via TaskTool
    const model = input.flags?.model ?? (input.flags?.apiKey ? 'google/gemini-2.5-pro' : 'gemini-2.5-pro')
    const envConfig = getCurrentConfig()

    const llmConfig = {
      accessToken: this.authToken.accessToken,
      apiBaseUrl: envConfig.llmApiBaseUrl,
      fileSystem: {workingDirectory: process.cwd()},
      llm: {
        // Plan Agent uses more iterations to coordinate subagents
        maxIterations: 15,
        maxTokens: 8192,
        temperature: 0.7,
        verbose: input.flags?.verbose ?? false,
      },
      model,
      openRouterApiKey: input.flags?.apiKey,
      projectId: PROJECT,
      sessionKey: this.authToken.sessionKey,
      teamId: this.brvConfig?.teamId ?? '',
    }

    // Create and start CipherAgent
    // Agent creates its default session during start() (Single-Session pattern)
    // Create and start CipherAgent (will use Plan Agent's tools and prompt)
    const agent = new CipherAgent(llmConfig, this.brvConfig)
    await agent.start()

    try {
      // Generate tracking request ID for backend metrics (separate from sessionId)
      const trackingRequestId = randomUUID()

      // Setup event listeners for tool call tracking
      this.setupToolCallTracking(agent, execution.id)

      // Build the prompt for the Plan Agent
      // The Plan Agent will orchestrate Query and Curate subagents via TaskTool
      const fileReferenceSection = input.fileReferenceInstructions ? `\n${input.fileReferenceInstructions}` : ''

      const prompt = `You are the Plan Agent orchestrating a context curation workflow.

The user wants to add the following context to the context tree:

---
${input.content}
---
${fileReferenceSection}

## Your Workflow

1. **Query Phase**: Use the \`task\` tool with subagent_type="query" to search for existing related knowledge topics in the context tree. This helps avoid duplicates and understand the current context structure.

2. **Curate Phase**: Based on the query results, use the \`task\` tool with subagent_type="curate" to create or update knowledge topics with the user's context.

## Important Guidelines

- Always query first to understand existing context before curating
- Provide clear, detailed prompts when delegating to subagents
- Summarize the results of each phase before proceeding to the next
- Report the final outcome: what topics were created or updated`

      const response = await agent.execute(prompt, {
        executionContext: {
          // Use 'plan' command type to get Plan Agent's tool set
          commandType: 'curate',
          fileReferenceInstructions: input.fileReferenceInstructions,
        },
        trackingRequestId,
      })

      // Mark completed
      storage.updateExecutionStatus(execution.id, 'completed', response)
      console.log(`[Consumer] Execution ${execution.id} completed`)
    } finally {
      // Stop agent to cleanup resources
      await agent.stop()
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
    let storage = getAgentStorageSync()
    let cleanupCounter = 0
    let orphanCheckCounter = 0

    while (this.running) {
      try {
        // Check if our lock is still valid (handles race condition when QueuePollingService reconnects first)
        // This covers both: DB file replaced AND another component already reconnected
        if (!storage.hasConsumerLock(this.consumerId)) {
          console.log('[Consumer] Lock lost, re-acquiring...')

          // If DB file also changed, reconnect first
          if (storage.isDbFileChanged()) {
            console.log('[Consumer] DB file changed, reconnecting...')
            // eslint-disable-next-line no-await-in-loop -- Must wait for reconnect before continuing
            await storage.reconnect()
            storage = getAgentStorageSync() // Get fresh reference after reconnect
          }

          // Re-acquire lock
          if (!storage.acquireConsumerLock(this.consumerId)) {
            console.error('[Consumer] Failed to re-acquire lock')
            this.stop()
            return
          }

          console.log(`[Consumer] Re-acquired lock (${this.consumerId.slice(0, 8)})`)
        }

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
        // Try to recover - re-acquire lock if lost
        // eslint-disable-next-line no-await-in-loop -- Must wait for recovery before continuing
        storage = await this.tryRecoverLock(storage)
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
          // Format result: if error, wrap in {error: "..."} object
          let resultStr: string
          if (payload.success) {
            resultStr = typeof payload.result === 'string' ? payload.result : JSON.stringify(payload.result)
          } else {
            // Error case: store as {error: "message"} format
            const errorMsg = payload.error ?? (typeof payload.result === 'string' ? payload.result : 'Unknown error')
            resultStr = JSON.stringify({error: errorMsg})
          }

          const metrics = payload.success ? calculateMetrics(payload.result) : undefined

          storage.updateToolCall(toolCallId, payload.success ? 'completed' : 'failed', {
            charsCount: metrics?.charsCount,
            linesCount: metrics?.linesCount,
            result: resultStr,
            resultSummary: payload.success ? createResultSummary(payload.result) : undefined,
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

  /**
   * Try to recover lock after error (extracted to reduce nesting depth)
   */
  private async tryRecoverLock(currentStorage: AgentStorage): Promise<AgentStorage> {
    try {
      let storage = getAgentStorageSync()
      if (!storage.hasConsumerLock(this.consumerId)) {
        if (storage.isDbFileChanged()) {
          await storage.reconnect()
          storage = getAgentStorageSync()
        }

        storage.acquireConsumerLock(this.consumerId)
        console.log('[Consumer] Recovered from error, re-acquired lock')
      }

      return storage
    } catch {
      // Ignore recovery errors, will retry on next poll
      return currentStorage
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
