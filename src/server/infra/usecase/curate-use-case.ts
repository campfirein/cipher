import {
  ConnectionError,
  ConnectionFailedError,
  DaemonSpawnError,
  InstanceCrashedError,
  type ITransportClient,
  NoInstanceRunningError,
  type TaskAck,
} from '@campfirein/brv-transport-client'
import {randomUUID} from 'node:crypto'
import {z} from 'zod'

import type {ITerminal} from '../../core/interfaces/services/i-terminal.js'
import type {CurateUseCaseRunOptions, ICurateUseCase} from '../../core/interfaces/usecase/i-curate-use-case.js'

import {ToolName} from '../../../agent/core/domain/tools/constants.js'
import {TaskErrorCode} from '../../core/domain/errors/task-error.js'
import {
  LlmEventNames,
  LlmToolResultEvent,
  TaskCompletedEvent,
  TaskErrorEvent,
  TransportTaskEventNames,
} from '../../core/domain/transport/index.js'
import {getSandboxEnvironmentName, isSandboxEnvironment, isSandboxNetworkError} from '../../utils/sandbox-detector.js'
import {HeadlessTerminal} from '../terminal/headless-terminal.js'
import {createDaemonAwareConnector, type TransportConnector} from '../transport/transport-connector.js'

export type {TransportConnector} from '../transport/transport-connector.js'

const CurateOperationSchema = z.object({
  filePath: z.string(),
  path: z.string(),
  status: z.enum(['success', 'failed']),
  type: z.enum(['ADD', 'UPDATE', 'MERGE', 'DELETE']),
})

const CurateResultSchema = z.object({
  result: z
    .object({
      applied: z.array(CurateOperationSchema).optional(),
    })
    .optional(),
})

type CurateOperation = z.infer<typeof CurateOperationSchema>

export interface CurateResult {
  message: string
  operations?: CurateOperation[]
  status: 'completed' | 'error' | 'queued'
  taskId?: string
}

export interface CurateUseCaseOptions {
  /** Delay between retry attempts (ms). Default: 2000. Set to 0 in tests. */
  retryDelayMs?: number
  terminal: ITerminal
  /** Optional transport connector for dependency injection (defaults to connectToTransport) */
  transportConnector?: TransportConnector
}

/** Max retry attempts when daemon disconnects mid-task */
const MAX_TASK_RETRIES = 3
/** Delay between retry attempts (ms) */
const RETRY_DELAY_MS = 2000
/** Grace period before treating 'reconnecting' as daemon death (ms) */
const DISCONNECT_GRACE_MS = 10_000

export class CurateUseCase implements ICurateUseCase {
  private readonly retryDelayMs: number
  private readonly terminal: ITerminal
  private readonly transportConnector: TransportConnector

  constructor(options: CurateUseCaseOptions) {
    this.retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS
    this.terminal = options.terminal
    this.transportConnector = options.transportConnector ?? createDaemonAwareConnector()
  }

  public async run({
    context,
    detach = false,
    files,
    folders,
    format = 'text',
    verbose = false,
  }: CurateUseCaseRunOptions): Promise<void> {
    const hasContext = Boolean(context?.trim())
    const hasFiles = Boolean(files?.length)
    const hasFolders = Boolean(folders?.length)

    if (!hasContext && !hasFiles && !hasFolders) {
      if (format === 'json') {
        this.outputJsonResult({
          message: 'Either a context argument, file reference, or folder reference is required.',
          status: 'error',
        })
      } else {
        this.terminal.log('Either a context argument, file reference, or folder reference is required.')
        this.terminal.log('Usage:')
        this.terminal.log('  brv curate "your context here"')
        this.terminal.log('  brv curate @src/file.ts')
        this.terminal.log('  brv curate @src/             # folder pack')
        this.terminal.log('  brv curate "context with files" @src/file.ts')
      }

      return
    }

    // Provide default context for folder packing when none is provided
    const resolvedContent = context?.trim()
      ? context
      : hasFolders
        ? 'Analyze this folder and extract all relevant knowledge, patterns, and documentation.'
        : ''
    const taskType = hasFolders ? 'curate-folder' : 'curate'

    // Retry loop: reconnect + resubmit on daemon/agent disconnection
    let lastError: unknown

    /* eslint-disable no-await-in-loop -- intentional sequential retry loop */
    for (let attempt = 1; attempt <= MAX_TASK_RETRIES; attempt++) {
      let client: ITransportClient | undefined
      let projectRoot: string | undefined

      try {
        const result = await this.createClient({verbose})
        client = result.client
        projectRoot = result.projectRoot

        if (verbose) {
          this.terminal.log(`Connected to instance (clientId: ${client.getClientId()})`)
        }

        const taskId = randomUUID()

        if (detach) {
          // Detach: enqueue and exit immediately.
          // The daemon runs the task in background — no need to block.
          await client.requestWithAck<TaskAck>(TransportTaskEventNames.CREATE, {
            clientCwd: process.cwd(),
            content: resolvedContent,
            ...(files?.length ? {files} : {}),
            ...(hasFolders && folders ? {folderPath: folders[0]} : {}),
            ...(projectRoot ? {projectPath: projectRoot} : {}),
            taskId,
            type: taskType,
          })

          if (format === 'json') {
            this.outputJsonResult({message: 'Context queued for processing', status: 'queued', taskId})
          } else {
            this.terminal.log('✓ Context queued for processing.')
          }
        } else {
          // Default: register listeners BEFORE task:create to avoid race conditions,
          // then wait for task:completed
          const completionPromise = this.waitForTaskCompletion(client, taskId, format)

          await client.requestWithAck<TaskAck>(TransportTaskEventNames.CREATE, {
            clientCwd: process.cwd(),
            content: resolvedContent,
            ...(files?.length ? {files} : {}),
            ...(hasFolders && folders ? {folderPath: folders[0]} : {}),
            ...(projectRoot ? {projectPath: projectRoot} : {}),
            taskId,
            type: taskType,
          })

          await completionPromise
        }

        // Success: cleanup and return
        await client.disconnect().catch(() => {})
        return
      } catch (error) {
        if (client) {
          await client.disconnect().catch(() => {})
        }

        lastError = error

        // Retry only for daemon/agent infrastructure failures
        if (this.isRetryableError(error) && attempt < MAX_TASK_RETRIES) {
          if (format === 'text') {
            this.terminal.log(`\nConnection lost. Restarting daemon... (attempt ${attempt + 1}/${MAX_TASK_RETRIES})`)
          }

          await new Promise<void>((resolve) => {
            setTimeout(resolve, this.retryDelayMs)
          })

          continue
        }

        break
      }
    }
    /* eslint-enable no-await-in-loop */

    // All retries exhausted or non-retryable error
    if (format === 'json') {
      this.handleConnectionErrorJson(lastError)
    } else {
      this.handleConnectionError(lastError)
    }

    // Force exit only for task-level disconnects (AGENT_DISCONNECTED) where Socket.IO
    // handles may leak. Connection errors (DaemonSpawnError, ConnectionFailedError) already
    // cleaned up their clients — no leaked handles.
    if (this.hasLeakedHandles(lastError)) {
      // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
      process.exit(1)
    }
  }

  private async createClient(options: {verbose: boolean}): Promise<{client: ITransportClient; projectRoot?: string}> {
    if (options.verbose) {
      this.terminal.log('Discovering running instance...')
    }

    const {client: connectedClient, projectRoot} = await this.transportConnector()
    return {client: connectedClient, projectRoot}
  }

  private handleConnectionError(error: unknown): void {
    if (error instanceof NoInstanceRunningError) {
      // Check if running in sandbox environment
      if (isSandboxEnvironment()) {
        const sandboxName = getSandboxEnvironmentName()
        this.terminal.log(
          `Error: No ByteRover instance is running.\n` +
            `⚠️  Sandbox environment detected (${sandboxName}).\n\n` +
            `Please run 'brv' command in a separate terminal window/tab outside the sandbox first.`,
        )
      } else {
        this.terminal.log(
          'No ByteRover instance is running.\n\n' +
            'Start a ByteRover instance by running "brv" in a separate terminal window/tab.\n' +
            'The instance will keep running and handle your commands.',
        )
      }

      return
    }

    if (error instanceof InstanceCrashedError) {
      this.terminal.log('ByteRover instance has crashed.\n\nPlease restart with: brv')
      return
    }

    if (error instanceof ConnectionFailedError) {
      // Check if it's specifically a sandbox network restriction error
      const isSandboxError = isSandboxNetworkError(error.originalError ?? error)

      if (isSandboxError) {
        const sandboxName = getSandboxEnvironmentName()
        this.terminal.log(
          `Error: Failed to connect to ByteRover instance.\n` +
            `Port: ${error.port ?? 'unknown'}\n` +
            `⚠️  Sandbox network restriction detected (${sandboxName}).\n\n` +
            `Please allow network access in the sandbox and retry the command.`,
        )
      } else {
        this.terminal.log(`Failed to connect to ByteRover instance: ${error.message}`)
      }

      return
    }

    if (error instanceof ConnectionError) {
      this.terminal.log(`Connection error: ${error.message}`)
      return
    }

    // LLM errors — detect auth or API key issues
    const message = error instanceof Error ? error.message : String(error)
    const lowerMessage = message.toLowerCase()

    if (
      lowerMessage.includes('401') ||
      lowerMessage.includes('unauthorized') ||
      lowerMessage.includes('authentication token')
    ) {
      this.terminal.log("LLM authentication required. Run 'brv login' to authenticate.")
      return
    }

    if (lowerMessage.includes('api key') || lowerMessage.includes('invalid key')) {
      this.terminal.log("LLM provider API key is missing or invalid. Run 'brv' then '/provider' to configure.")
      return
    }

    this.terminal.log(`Unexpected error: ${message}`)
  }

  /**
   * Handle connection errors with JSON output.
   */
  private handleConnectionErrorJson(error: unknown): void {
    let errorMessage = 'An unexpected error occurred'

    if (error instanceof NoInstanceRunningError) {
      errorMessage = 'No ByteRover instance is running. Start one with: brv'
    } else if (error instanceof InstanceCrashedError) {
      errorMessage = 'ByteRover instance has crashed. Please restart with: brv'
    } else if (error instanceof ConnectionFailedError) {
      errorMessage = `Failed to connect to ByteRover instance: ${error.message}`
    } else if (error instanceof ConnectionError) {
      errorMessage = `Connection error: ${error.message}`
    } else if (error instanceof Error) {
      const lowerMessage = error.message.toLowerCase()
      if (
        lowerMessage.includes('401') ||
        lowerMessage.includes('unauthorized') ||
        lowerMessage.includes('authentication token')
      ) {
        errorMessage = "LLM authentication required. Run 'brv login' to authenticate."
      } else if (lowerMessage.includes('api key') || lowerMessage.includes('invalid key')) {
        errorMessage = "LLM provider API key is missing or invalid. Run 'brv' then '/provider' to configure."
      } else {
        errorMessage = error.message
      }
    }

    this.outputJsonResult({message: errorMessage, status: 'error'})
  }

  /**
   * Checks if an error left leaked Socket.IO handles that prevent Node.js from exiting.
   * Only task-level disconnects (mid-task daemon death) leak handles.
   * Connection errors (DaemonSpawnError, ConnectionFailedError) clean up their clients.
   */
  private hasLeakedHandles(error: unknown): boolean {
    if (!(error instanceof Error)) return false
    if (!('code' in error)) return false
    return error.code === TaskErrorCode.AGENT_DISCONNECTED || error.code === TaskErrorCode.AGENT_NOT_AVAILABLE
  }

  /**
   * Checks if an error is retryable (daemon/agent infrastructure failure).
   * Retryable: agent disconnected, agent not available, daemon spawn timeout, connection failed.
   * Non-retryable: auth errors, project not init, LLM errors, file validation, no instance running.
   */
  private isRetryableError(error: unknown): boolean {
    // Connection infrastructure errors — daemon spawned but slow, or connection dropped
    if (error instanceof DaemonSpawnError || error instanceof ConnectionFailedError) return true
    // Task-level errors — agent disconnected mid-task
    return this.hasLeakedHandles(error)
  }

  /**
   * Output JSON result for headless mode.
   */
  private outputJsonResult(result: CurateResult): void {
    const response = {
      command: 'curate',
      data: result,
      success: result.status !== 'error',
      timestamp: new Date().toISOString(),
    }

    if (this.terminal instanceof HeadlessTerminal) {
      this.terminal.writeFinalResponse(response)
    } else {
      this.terminal.log(JSON.stringify(response))
    }
  }

  /**
   * Wait for task completion.
   * Listens for task:completed or task:error events before returning.
   */
  private async waitForTaskCompletion(
    client: ITransportClient,
    taskId: string,
    format: 'json' | 'text',
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let completed = false
      let disconnectTimer: NodeJS.Timeout | undefined
      const operations: CurateOperation[] = []

      const rejectRetryable = (message: string): void => {
        if (completed) return
        completed = true
        cleanup()
        reject(Object.assign(new Error(message), {code: TaskErrorCode.AGENT_DISCONNECTED}))
      }

      const timeout = setTimeout(
        () => {
          if (!completed) {
            completed = true
            cleanup()
            if (format === 'json') {
              this.outputJsonResult({message: 'Task timed out after 5 minutes', status: 'error'})
              resolve()
            } else {
              reject(new Error('Task timed out after 5 minutes'))
            }
          }
        },
        5 * 60 * 1000,
      )

      const unsubscribers = [
        client.on<LlmToolResultEvent>(LlmEventNames.TOOL_RESULT, (payload) => {
          if (payload.success && payload.toolName === ToolName.CURATE && payload.result) {
            try {
              const parsed = CurateResultSchema.parse(JSON.parse(payload.result as string))
              for (const op of parsed.result?.applied ?? []) {
                if (op.status === 'success') {
                  operations.push(op)
                }
              }
            } catch {
              // Ignore parse errors
            }
          }
        }),

        client.on<TaskCompletedEvent>(TransportTaskEventNames.COMPLETED, (payload) => {
          if (payload.taskId === taskId && !completed) {
            completed = true
            cleanup()
            if (format === 'json') {
              this.outputJsonResult({
                message: 'Context curated successfully',
                operations: operations.length > 0 ? operations : undefined,
                status: 'completed',
                taskId,
              })
            } else {
              for (const op of operations) {
                this.terminal.log(`  ${op.type.toLowerCase()} ${op.filePath}`)
              }

              this.terminal.log('✓ Context curated successfully.')
            }

            resolve()
          }
        }),

        // task:error - preserve error code for retry detection
        client.on<TaskErrorEvent>(TransportTaskEventNames.ERROR, (payload) => {
          if (payload.taskId === taskId && !completed) {
            completed = true
            cleanup()
            if (format === 'json') {
              this.outputJsonResult({message: payload.error.message, status: 'error'})
              resolve()
            } else {
              reject(Object.assign(new Error(payload.error.message), {code: payload.error.code}))
            }
          }
        }),

        // Disconnect detection: fast recovery when daemon dies (SIGKILL)
        client.onStateChange((state) => {
          if (completed) return

          if (state === 'reconnecting') {
            disconnectTimer = setTimeout(() => {
              rejectRetryable('Daemon disconnected')
            }, DISCONNECT_GRACE_MS)
          }

          if (state === 'connected' && disconnectTimer) {
            clearTimeout(disconnectTimer)
            disconnectTimer = undefined
          }

          if (state === 'disconnected') {
            if (disconnectTimer) {
              clearTimeout(disconnectTimer)
              disconnectTimer = undefined
            }

            rejectRetryable('Daemon disconnected')
          }
        }),

        () => clearTimeout(timeout),
        () => {
          if (disconnectTimer) clearTimeout(disconnectTimer)
        },
      ]

      const cleanup = (): void => {
        for (const unsub of unsubscribers) unsub()
      }
    })
  }
}
