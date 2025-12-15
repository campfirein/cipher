import {Args, Command, Flags} from '@oclif/core'

import type {ICurateUseCase} from '../core/interfaces/usecase/i-curate-use-case.js'

import {isDevelopment} from '../config/environment.js'
import {ProjectConfigStore} from '../infra/config/file-config-store.js'
import {FileGlobalConfigStore} from '../infra/storage/file-global-config-store.js'
import {KeychainTokenStore} from '../infra/storage/keychain-token-store.js'
import {OclifTerminal} from '../infra/terminal/oclif-terminal.js'
import {MixpanelTrackingService} from '../infra/tracking/mixpanel-tracking-service.js'
import {CurateUseCase} from '../infra/usecase/curate-use-case.js'

export default class Curate extends Command {
  public static args = {
    context: Args.string({
      description: 'Knowledge context: patterns, decisions, errors, or insights',
      required: false,
    }),
  }
  public static description = `Curate context to the context tree (autonomous mode)

For interactive mode, use REPL: brv repl then /curate

Good examples:
- "Auth uses JWT with 24h expiry. Tokens stored in httpOnly cookies via authMiddleware.ts"
- "API rate limit is 100 req/min per user. Implemented using Redis with sliding window in rateLimiter.ts"
Bad examples:
- "Authentication" or "JWT tokens" (too vague, lacks context)
- "Rate limiting" (no implementation details or file references)`
  public static examples = [
    '# Autonomous mode - LLM auto-categorizes your context',
    '<%= config.bin %> <%= command.id %> "Auth uses JWT with 24h expiry. Tokens stored in httpOnly cookies via authMiddleware.ts"',
    '',
    '# Include relevant files for comprehensive context (use sparingly, max 5 files)',
    '- NOTE: CONTEXT argument must come BEFORE --files flag',
    '- NOTE: For multiple files, repeat --files (or -f) flag for each file',
    '- NOTE: Only text/code files from current project directory.',
    '',
    '## Single file',
    '<%= config.bin %> <%= command.id %> "Authentication middleware validates JWT tokens and attaches user context" -f src/middleware/auth.ts',
    '',
    '## Multiple files',
    '<%= config.bin %> <%= command.id %> "JWT authentication implementation with refresh token rotation" --files src/auth/jwt.ts --files docs/auth.md',
    '',
    ...(isDevelopment()
      ? [
          '# Autonomous mode with OpenRouter (development only)',
          '<%= config.bin %> <%= command.id %> -k YOUR_API_KEY "React components follow atomic design in src/components/. Atoms in atoms/, molecules in molecules/, organisms in organisms/"',
          '',
          '# Autonomous mode with custom model (development only)',
          '<%= config.bin %> <%= command.id %> -k YOUR_API_KEY -m anthropic/claude-sonnet-4 "API rate limit is 100 req/min per user. Implemented using Redis with sliding window in rateLimiter.ts"',
        ]
      : []),
  ]
  public static flags = {
    files: Flags.string({
      char: 'f',
      description:
        'Include specific file paths for critical context (max 5 files). Only text/code files from the current project directory are allowed. Use sparingly - only for truly relevant files like docs or key implementation details. NOTE: CONTEXT argument must come BEFORE this flag.',
      multiple: true,
    }),
    ...(isDevelopment()
      ? {
          apiKey: Flags.string({
            char: 'k',
            description: 'OpenRouter API key (use OpenRouter instead of internal gRPC backend) [Development only]',
            env: 'OPENROUTER_API_KEY',
          }),
          model: Flags.string({
            char: 'm',
            description:
              'Model to use (default: google/gemini-2.5-pro for OpenRouter, gemini-2.5-pro for gRPC) [Development only]',
          }),
          verbose: Flags.boolean({
            char: 'v',
            default: false,
            description: 'Enable verbose debug output [Development only]',
          }),
        }
      : {}),
  }

  protected createUseCase(): ICurateUseCase {
    const tokenStore = new KeychainTokenStore()
    const globalConfigStore = new FileGlobalConfigStore()
    return new CurateUseCase({
      projectConfigStore: new ProjectConfigStore(),
      terminal: new OclifTerminal(this),
      tokenStore,
      trackingService: new MixpanelTrackingService({globalConfigStore, tokenStore}),
    })
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(Curate)

    if (!args.context) {
      this.log('Context argument is required.\nFor interactive mode, use REPL: brv /curate')
      return
    }

    await this.createUseCase().run({
      apiKey: flags.apiKey,
      context: args.context,
      files: flags.files,
      model: flags.model,
      verbose: flags.verbose,
    })
  }
}
