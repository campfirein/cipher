import {Args, Command, Flags} from '@oclif/core'

import type {TaskCreateResponse} from '../core/domain/transport/schemas.js'
import type {ITransportClient} from '../core/interfaces/transport/i-transport-client.js'

import {isDevelopment} from '../config/environment.js'
import {createTransportClientFactory} from '../infra/transport/transport-client-factory.js'
import {handleConnectionError} from '../utils/connection-error-handler.js'

/** Parsed flags type */
type CurateFlags = {
  files?: string[]
  verbose?: boolean
}

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
    const {args, flags: rawFlags} = await this.parse(Curate)
    const flags = rawFlags as CurateFlags

    if (!args.context) {
      this.log('Context argument is required.')
      this.log('Usage: brv curate "your context here"')
      return
    }

    const verbose = flags.verbose ?? false
    const {files} = flags

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
      await client.request<TaskCreateResponse>('task:create', {
        content: args.context,
        ...(files?.length ? {files} : {}),
        type: 'curate',
      })

      this.log('✓ Context queued for processing.')
      // Fire and exit - TUI shows processing in background
    } catch (error) {
      handleConnectionError(error, (msg, opts) => this.error(msg, opts))
    } finally {
      if (client) {
        await client.disconnect()
      }
    }
  }
}
