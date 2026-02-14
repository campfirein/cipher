import {Args, Command, Flags} from '@oclif/core'

import {isDevelopment} from '../../server/config/environment.js'
import {ICurateUseCase} from '../../server/core/interfaces/usecase/i-curate-use-case.js'
import {HeadlessTerminal} from '../../server/infra/terminal/headless-terminal.js'
import {CurateUseCase} from '../../server/infra/usecase/curate-use-case.js'

/** Parsed flags type */
type CurateFlags = {
  detach?: boolean
  files?: string[]
  folder?: string[]
  format?: 'json' | 'text'
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
    '',
    '# Folder pack - analyze and curate entire folder',
    '<%= config.bin %> <%= command.id %> --folder src/auth/',
    '',
    '# Folder pack with context',
    '<%= config.bin %> <%= command.id %> "Analyze authentication module" -d src/auth/',
  ]
  public static flags = {
    detach: Flags.boolean({
      default: false,
      description: 'Queue task and exit without waiting for completion',
    }),
    files: Flags.string({
      char: 'f',
      description: 'Include specific file paths for critical context (max 5 files)',
      multiple: true,
    }),
    folder: Flags.string({
      char: 'd',
      description: 'Folder path to pack and analyze (triggers folder pack flow)',
      multiple: true,
    }),
    format: Flags.string({
      default: 'text',
      description: 'Output format (text or json)',
      options: ['text', 'json'],
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

  protected createUseCase(options: {format: 'json' | 'text'}): ICurateUseCase {
    const terminal = new HeadlessTerminal({failOnPrompt: true, outputFormat: options.format})

    return new CurateUseCase({terminal})
  }

  public async run(): Promise<void> {
    const {args, flags: rawFlags} = await this.parse(Curate)
    const flags = rawFlags as CurateFlags
    const format = (flags.format ?? 'text') as 'json' | 'text'

    return this.createUseCase({format}).run({
      context: args.context,
      detach: flags.detach,
      files: flags.files,
      folders: flags.folder,
      format,
      verbose: flags.verbose,
    })
  }
}
