import {Args, Command, Flags} from '@oclif/core'

import {isDevelopment} from '../config/environment.js'
import {ICurateUseCase} from '../core/interfaces/usecase/i-curate-use-case.js'
import {FileGlobalConfigStore} from '../infra/storage/file-global-config-store.js'
import {createTokenStore} from '../infra/storage/token-store.js'
import {OclifTerminal} from '../infra/terminal/oclif-terminal.js'
import {MixpanelTrackingService} from '../infra/tracking/mixpanel-tracking-service.js'
import {CurateUseCase} from '../infra/usecase/curate-use-case.js'

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

  protected createUseCase(): ICurateUseCase {
    const tokenStore = createTokenStore()
    const globalConfigStore = new FileGlobalConfigStore()
    const terminal = new OclifTerminal(this)
    const trackingService = new MixpanelTrackingService({globalConfigStore, tokenStore})

    return new CurateUseCase({terminal, trackingService})
  }

  public async run(): Promise<void> {
    const {args, flags: rawFlags} = await this.parse(Curate)
    const flags = rawFlags as CurateFlags

    return this.createUseCase().run({context: args.context, files: flags.files, verbose: flags.verbose})
  }
}
