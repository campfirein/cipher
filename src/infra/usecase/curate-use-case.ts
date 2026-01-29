import {randomUUID} from 'node:crypto'

import type {ITerminal} from '../../core/interfaces/i-terminal.js'
import type {CurateUseCaseRunOptions, ICurateUseCase} from '../../core/interfaces/usecase/i-curate-use-case.js'

import {ConnectionError, ConnectionFailedError, InstanceCrashedError, NoInstanceRunningError} from '../../core/domain/errors/connection-error.js'
import {TaskCreateResponse} from '../../core/domain/transport/index.js'
import {ITrackingService} from '../../core/interfaces/i-tracking-service.js'
import {ITransportClient} from '../../core/interfaces/transport/index.js'
import {formatError} from '../../utils/error-handler.js'
import {getSandboxEnvironmentName, isSandboxEnvironment, isSandboxNetworkError} from '../../utils/sandbox-detector.js'
import {createTransportClientFactory, type TransportClientFactory} from '../transport/transport-client-factory.js'

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

  public async run({context, files, verbose = false}: CurateUseCaseRunOptions): Promise<void> {
    await this.trackingService.track('mem:curate', {status: 'started'})

    const hasContext = Boolean(context?.trim())
    const hasFiles = Boolean(files?.length)

    if (!hasContext && !hasFiles) {
      this.terminal.log('Either a context argument or file reference is required.')
      this.terminal.log('Usage:')
      this.terminal.log('  brv curate "your context here"')
      this.terminal.log('  brv curate @src/file.ts')
      this.terminal.log('  brv curate "context with files" @src/file.ts')
      return;
    }

    const resolvedContent = context?.trim() ? context : ''

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
        content: resolvedContent,
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
