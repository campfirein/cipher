import {
  ConnectionError,
  ConnectionFailedError,
  connectToTransport,
  DaemonInstanceDiscovery,
  InstanceCrashedError,
  type ITransportClient,
  NoInstanceRunningError,
  type TaskAck,
} from '@campfirein/brv-transport-client'
import {randomUUID} from 'node:crypto'
import {z} from 'zod'

import type {ITerminal} from '../../core/interfaces/services/i-terminal.js'
import type {CurateUseCaseRunOptions, ICurateUseCase} from '../../core/interfaces/usecase/i-curate-use-case.js'
import type {TransportConnector} from '../transport/transport-connector.js'

import {ToolName} from '../../../agent/infra/tools/index.js'
import {LlmToolResultEvent, TaskCompletedEvent, TaskErrorEvent} from '../../core/domain/transport/index.js'
import {ITrackingService} from '../../core/interfaces/services/i-tracking-service.js'
import {formatError} from '../../utils/error-handler.js'
import {getSandboxEnvironmentName, isSandboxEnvironment, isSandboxNetworkError} from '../../utils/sandbox-detector.js'
import {InlineAgent} from '../process/inline-agent-executor.js'
import {HeadlessTerminal} from '../terminal/headless-terminal.js'

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
  terminal: ITerminal
  trackingService: ITrackingService
  /** Optional transport connector for dependency injection (defaults to connectToTransport) */
  transportConnector?: TransportConnector
}

export class CurateUseCase implements ICurateUseCase {
  private readonly terminal: ITerminal
  private readonly trackingService: ITrackingService
  private readonly transportConnector: TransportConnector

  constructor(options: CurateUseCaseOptions) {
    this.terminal = options.terminal
    this.trackingService = options.trackingService
    this.transportConnector =
      options.transportConnector ??
      ((fromDir) => connectToTransport(fromDir, {discovery: new DaemonInstanceDiscovery()}))
  }

  public async run({
    context,
    files,
    format = 'text',
    headless = false,
    verbose = false,
  }: CurateUseCaseRunOptions): Promise<void> {
    await this.trackingService.track('mem:curate', {status: 'started'})

    const hasContext = Boolean(context?.trim())
    const hasFiles = Boolean(files?.length)

    if (!hasContext && !hasFiles) {
      if (format === 'json') {
        this.outputJsonResult({message: 'Either a context argument or file reference is required.', status: 'error'})
      } else {
        this.terminal.log('Either a context argument or file reference is required.')
        this.terminal.log('Usage:')
        this.terminal.log('  brv curate "your context here"')
        this.terminal.log('  brv curate @src/file.ts')
        this.terminal.log('  brv curate "context with files" @src/file.ts')
      }

      return
    }

    const resolvedContent = context?.trim() ? context : ''

    let client: ITransportClient | undefined

    try {
      client = await this.createClient({headless, verbose})

      if (verbose) {
        this.terminal.log(`Connected to instance (clientId: ${client.getClientId()})`)
      }

      // Generate taskId in UseCase (Application layer owns task creation)
      const taskId = randomUUID()

      // Send task:create request
      await client.requestWithAck<TaskAck>('task:create', {
        clientCwd: process.cwd(),
        content: resolvedContent,
        ...(files?.length ? {files} : {}),
        taskId,
        type: 'curate',
      })

      if (headless) {
        // In headless mode, wait for the in-process task to complete
        await this.waitForTaskCompletion(client, taskId, format)
      } else if (format === 'json') {
        this.outputJsonResult({message: 'Context queued for processing', status: 'queued', taskId})
      } else {
        this.terminal.log('✓ Context queued for processing.')
      }

      await this.trackingService.track('mem:curate', {status: 'finished'})
    } catch (error) {
      if (format === 'json') {
        this.handleConnectionErrorJson(error)
      } else {
        this.handleConnectionError(error)
      }

      await this.trackingService.track('mem:curate', {message: formatError(error), status: 'error'})
    } finally {
      if (client) {
        await client.disconnect()
      }
    }
  }

  private async createClient(options: {headless: boolean; verbose: boolean}): Promise<ITransportClient> {
    if (options.headless) {
      const inlineAgent = await InlineAgent.create()
      return inlineAgent.transportClient
    }

    if (options.verbose) {
      this.terminal.log('Discovering running instance...')
    }

    // Use modern connectToTransport API (auto-discovers and connects)
    const {client: connectedClient} = await this.transportConnector()
    return connectedClient
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

    const message = error instanceof Error ? error.message : String(error)
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
      errorMessage = error.message
    }

    this.outputJsonResult({message: errorMessage, status: 'error'})
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
   * Wait for task completion in headless mode.
   * Listens for task:completed or task:error events before returning.
   */
  private async waitForTaskCompletion(
    client: ITransportClient,
    taskId: string,
    format: 'json' | 'text',
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let completed = false
      const operations: CurateOperation[] = []

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
        client.on<LlmToolResultEvent>('llmservice:toolResult', (payload) => {
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

        client.on<TaskCompletedEvent>('task:completed', (payload) => {
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

        client.on<TaskErrorEvent>('task:error', (payload) => {
          if (payload.taskId === taskId && !completed) {
            completed = true
            cleanup()
            if (format === 'json') {
              this.outputJsonResult({message: payload.error.message, status: 'error'})
              resolve()
            } else {
              reject(new Error(payload.error.message))
            }
          }
        }),

        () => clearTimeout(timeout),
      ]

      const cleanup = (): void => {
        for (const unsub of unsubscribers) unsub()
      }
    })
  }
}
