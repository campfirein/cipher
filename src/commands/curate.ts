import {Args, Command, Flags} from '@oclif/core'

import type {TaskCreateResponse} from '../core/domain/transport/schemas.js'
import type {ITransportClient} from '../core/interfaces/transport/i-transport-client.js'

import {isDevelopment} from '../config/environment.js'
import {
  ConnectionError,
  ConnectionFailedError,
  InstanceCrashedError,
  NoInstanceRunningError,
} from '../core/domain/errors/connection-error.js'
import {createTransportClientFactory} from '../infra/transport/transport-client-factory.js'

export default class Curate extends Command {
  public static args = {
    context: Args.string({
      description: 'Knowledge context: patterns, decisions, errors, or insights',
      required: false,
    }),
  }
  public static description = `Curate context to the context tree (connects to running brv instance)

Requires a running brv instance. Start one with: brv start

Good examples:
- "Auth uses JWT with 24h expiry. Tokens stored in httpOnly cookies via authMiddleware.ts"
- "API rate limit is 100 req/min per user. Implemented using Redis with sliding window in rateLimiter.ts"
Bad examples:
- "Authentication" or "JWT tokens" (too vague, lacks context)
- "Rate limiting" (no implementation details or file references)`
  public static examples = [
    '# Curate context - queues task for background processing',
    '<%= config.bin %> <%= command.id %> "Auth uses JWT with 24h expiry. Tokens stored in httpOnly cookies via authMiddleware.ts"',
    '',
    '# Include relevant files for comprehensive context (max 5 files)',
    '<%= config.bin %> <%= command.id %> "Authentication middleware validates JWT tokens" -f src/middleware/auth.ts',
    '',
    '# Multiple files',
    '<%= config.bin %> <%= command.id %> "JWT authentication implementation" --files src/auth/jwt.ts --files docs/auth.md',
  ]
  public static flags = {
    files: Flags.string({
      char: 'f',
      description: 'Include specific file paths for critical context (max 5 files)',
      multiple: true,
    }),
    ...(isDevelopment()
      ? {
          verbose: Flags.boolean({
            char: 'v',
            default: false,
            description: 'Enable verbose debug output [Development only]',
          }),
        }
      : {}),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(Curate)

    if (!args.context) {
      this.log('Context argument is required.')
      this.log('Usage: brv curate "your context here"')
      return
    }

    const verbose = (flags as {verbose?: boolean}).verbose ?? false
    const files = (flags as {files?: string[]}).files

    let client: ITransportClient | undefined

    try {
      const factory = createTransportClientFactory()

      if (verbose) {
        this.log('Discovering running instance...')
      }

      const {client: connectedClient} = await factory.connect()
      client = connectedClient

      if (verbose) {
        this.log(`Connected to instance (clientId: ${client.getClientId()})`)
      }

      // Send task:create - Transport routes to Agent, UseCase handles logic
      const response = await client.request<TaskCreateResponse>('task:create', {
        ...(files?.length ? {files} : {}),
        input: args.context,
        type: 'curate',
      })

      // Fire and exit - TUI shows processing in background
      this.log(`✓ Context queued (${response.taskId.slice(0, 8)})`)
    } catch (error) {
      this.handleConnectionError(error)
    } finally {
      if (client) {
        await client.disconnect()
      }
    }
  }

  private handleConnectionError(error: unknown): void {
    if (error instanceof NoInstanceRunningError) {
      this.error('No ByteRover instance is running.\n\nStart one with: brv start', {exit: 1})
    }

    if (error instanceof InstanceCrashedError) {
      this.error('ByteRover instance has crashed.\n\nPlease restart with: brv start', {exit: 1})
    }

    if (error instanceof ConnectionFailedError) {
      this.error(`Failed to connect to ByteRover instance: ${error.message}`, {exit: 1})
    }

    if (error instanceof ConnectionError) {
      this.error(`Connection error: ${error.message}`, {exit: 1})
    }

    const message = error instanceof Error ? error.message : String(error)
    this.error(`Unexpected error: ${message}`, {exit: 1})
  }
}
