import {randomUUID} from 'node:crypto'

import type {ITerminal} from '../../core/interfaces/i-terminal.js'
import type {CurateUseCaseRunOptions, ICurateUseCase} from '../../core/interfaces/usecase/i-curate-use-case.js'

import {ConnectionError, ConnectionFailedError, InstanceCrashedError, NoInstanceRunningError} from '../../core/domain/errors/connection-error.js'
import {TaskCreateResponse} from '../../core/domain/transport/index.js'
import {ITrackingService} from '../../core/interfaces/i-tracking-service.js'
import {ITransportClient} from '../../core/interfaces/transport/index.js'
import {formatError} from '../../utils/error-handler.js'
import {getSandboxEnvironmentName, isSandboxEnvironment, isSandboxNetworkError} from '../../utils/sandbox-detector.js'
import {HeadlessTerminal} from '../terminal/headless-terminal.js'
import {createTransportClientFactory, type TransportClientFactory} from '../transport/transport-client-factory.js'

/**
 * Structured curate result for JSON output.
 */
export interface CurateResult {
  message: string
  status: 'error' | 'queued'
  taskId?: string
}

export type TransportClientFactoryCreator = () => TransportClientFactory

export interface CurateUseCaseOptions {
  terminal: ITerminal
  trackingService: ITrackingService
  /** Optional factory creator for dependency injection (defaults to createTransportClientFactory) */
  transportClientFactoryCreator?: TransportClientFactoryCreator
}

export class CurateUseCase implements ICurateUseCase {
  private readonly terminal: ITerminal
  private readonly trackingService: ITrackingService
  private readonly transportClientFactoryCreator: TransportClientFactoryCreator

  constructor(options: CurateUseCaseOptions) {
    this.terminal = options.terminal
    this.trackingService = options.trackingService
    this.transportClientFactoryCreator = options.transportClientFactoryCreator ?? createTransportClientFactory
  }

  public async run({context, files, format = 'text', verbose = false}: CurateUseCaseRunOptions): Promise<void> {
    await this.trackingService.track('mem:curate', {status: 'started'})

    if (!context) {
      if (format === 'json') {
        this.outputJsonResult({message: 'Context argument is required', status: 'error'})
      } else {
        this.terminal.log('Context argument is required.')
        this.terminal.log('Usage: brv curate "your context here"')
      }

      return
    }

    let client: ITransportClient | undefined

    try {
      const transportClientFactory = this.transportClientFactoryCreator()

      if (verbose) {
        this.terminal.log('Discovering running instance...')
      }

      const {client: connectedClient} = await transportClientFactory.connect()
      client = connectedClient

      if (verbose) {
        this.terminal.log(`Connected to instance (clientId: ${client.getClientId()})`)
      }

      // Generate taskId in UseCase (Application layer owns task creation)
      const taskId = randomUUID()

      await client.request<TaskCreateResponse>('task:create', {
        clientCwd: process.cwd(),
        content: context,
        ...(files?.length ? {files} : {}),
        taskId,
        type: 'curate',
      })

      if (format === 'json') {
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
}
