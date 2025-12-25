import {randomUUID} from 'node:crypto'

import type {ITerminal} from '../../core/interfaces/i-terminal.js'
import type {CurateUseCaseRunOptions, ICurateUseCase} from '../../core/interfaces/usecase/i-curate-use-case.js'

import {
  ConnectionError,
  ConnectionFailedError,
  InstanceCrashedError,
  NoInstanceRunningError,
} from '../../core/domain/errors/connection-error.js'
import {TaskCreateResponse} from '../../core/domain/transport/index.js'
import {ITrackingService} from '../../core/interfaces/i-tracking-service.js'
import {ITransportClient} from '../../core/interfaces/transport/index.js'
import {formatError} from '../../utils/error-handler.js'
import {getSandboxEnvironmentName, isSandboxEnvironment, isSandboxNetworkError} from '../../utils/sandbox-detector.js'
import {createTransportClientFactory, TransportClientFactory} from '../transport/transport-client-factory.js'

export interface CurateUseCaseOptions {
  terminal: ITerminal
  trackingService: ITrackingService
}

export class CurateUseCase implements ICurateUseCase {
  private readonly terminal: ITerminal
  private readonly trackingService: ITrackingService

  constructor(options: CurateUseCaseOptions) {
    this.terminal = options.terminal
    this.trackingService = options.trackingService
  }

  /**
   * Create transport client factory. Protected to allow test overrides.
   */
  protected createTransportFactory(): TransportClientFactory {
    return createTransportClientFactory()
  }

  public async run({context, files, verbose = false}: CurateUseCaseRunOptions): Promise<void> {
    await this.trackingService.track('mem:curate', {status: 'started'})
    if (!context) {
      this.terminal.log('Context argument is required.')
      this.terminal.log('Usage: brv curate "your context here"')
      return
    }

    let client: ITransportClient | undefined

    try {
      const factory = this.createTransportFactory()

      if (verbose) {
        this.terminal.log('Discovering running instance...')
      }

      const {client: connectedClient} = await factory.connect()
      client = connectedClient

      if (verbose) {
        this.terminal.log(`Connected to instance (clientId: ${client.getClientId()})`)
      }

      // Generate taskId in UseCase (Application layer owns task creation)
      const taskId = randomUUID()

      // Send task:create - Transport routes to Agent, UseCase handles logic
      await client.request<TaskCreateResponse>('task:create', {
        content: context,
        ...(files?.length ? {files} : {}),
        taskId,
        type: 'curate',
      })

      this.terminal.log('✓ Context queued for processing.')
      await this.trackingService.track('mem:curate', {status: 'finished'})
    } catch (error) {
      this.handleConnectionError(error)
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
}
