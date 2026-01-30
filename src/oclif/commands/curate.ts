import {Args, Command, Flags} from '@oclif/core'

import {isDevelopment} from '../../config/environment.js'
import {ICurateUseCase} from '../../core/interfaces/usecase/i-curate-use-case.js'
import {FileGlobalConfigStore} from '../../infra/storage/file-global-config-store.js'
import {createTokenStore} from '../../infra/storage/token-store.js'
import {HeadlessTerminal} from '../../infra/terminal/headless-terminal.js'
import {OclifTerminal} from '../../infra/terminal/oclif-terminal.js'
import {MixpanelTrackingService} from '../../infra/tracking/mixpanel-tracking-service.js'
import {CurateUseCase} from '../../infra/usecase/curate-use-case.js'

/** Parsed flags type */
type CurateFlags = {
  files?: string[]
  format?: 'json' | 'text'
  headless?: boolean
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

Requires a running brv instance. Start one with: brv

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
    format: Flags.string({
      default: 'text',
      description: 'Output format (text or json)',
      options: ['text', 'json'],
    }),
    headless: Flags.boolean({
      default: false,
      description: 'Run in headless mode (no TTY required, suitable for automation)',
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

  protected createUseCase(options: {format: 'json' | 'text'; headless: boolean}): ICurateUseCase {
    const tokenStore = createTokenStore()
    const globalConfigStore = new FileGlobalConfigStore()
    const trackingService = new MixpanelTrackingService({globalConfigStore, tokenStore})

    // Use HeadlessTerminal for headless mode or JSON format
    const terminal =
      options.headless || options.format === 'json'
        ? new HeadlessTerminal({failOnPrompt: true, outputFormat: options.format})
        : new OclifTerminal(this)

    return new CurateUseCase({terminal, trackingService})
  }

  public async run(): Promise<void> {
    const {args, flags: rawFlags} = await this.parse(Curate)
    const flags = rawFlags as CurateFlags
    const format = (flags.format ?? 'text') as 'json' | 'text'
    const headless = flags.headless ?? false

    return this.createUseCase({format, headless}).run({
      context: args.context,
      files: flags.files,
      format,
      headless,
      verbose: flags.verbose,
    })
  }
}
