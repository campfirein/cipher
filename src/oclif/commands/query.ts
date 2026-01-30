import {Args, Command, Flags} from '@oclif/core'

import {isDevelopment} from '../../config/environment.js'
import {IQueryUseCase} from '../../core/interfaces/usecase/i-query-use-case.js'
import {FileGlobalConfigStore} from '../../infra/storage/file-global-config-store.js'
import {createTokenStore} from '../../infra/storage/token-store.js'
import {HeadlessTerminal} from '../../infra/terminal/headless-terminal.js'
import {OclifTerminal} from '../../infra/terminal/oclif-terminal.js'
import {MixpanelTrackingService} from '../../infra/tracking/mixpanel-tracking-service.js'
import {QueryUseCase} from '../../infra/usecase/query-use-case.js'

/** Parsed flags type */
type QueryFlags = {
  format?: 'json' | 'text'
  headless?: boolean
  verbose?: boolean
}

export default class Query extends Command {
  public static args = {
    query: Args.string({
      description: 'Natural language question about your codebase or project knowledge',
      required: true,
    }),
  }
  public static description = `Query and retrieve information from the context tree (connects to running brv instance)

Requires a running brv instance. Start one with: brv

Good:
- "How is user authentication implemented?"
- "What are the API rate limits and where are they enforced?"
Bad:
- "auth" or "authentication" (too vague, not a question)
- "show me code" (not specific about what information is needed)`
  public static examples = [
    '# Ask questions about patterns, decisions, or implementation details',
    '<%= config.bin %> <%= command.id %> What are the coding standards?',
    '<%= config.bin %> <%= command.id %> How is authentication implemented?',
    '',
    '# Headless mode with JSON output (for automation)',
    '<%= config.bin %> <%= command.id %> "How does auth work?" --headless --format json',
  ]
  public static flags = {
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
  public static strict = false

  protected createUseCase(options: {format: 'json' | 'text'; headless: boolean}): IQueryUseCase {
    const tokenStore = createTokenStore()
    const globalConfigStore = new FileGlobalConfigStore()
    const trackingService = new MixpanelTrackingService({globalConfigStore, tokenStore})

    // Use HeadlessTerminal for headless mode or JSON format
    const terminal =
      options.headless || options.format === 'json'
        ? new HeadlessTerminal({failOnPrompt: true, outputFormat: options.format})
        : new OclifTerminal(this)

    return new QueryUseCase({
      terminal,
      trackingService,
    })
  }

  public async run(): Promise<void> {
    const {args, flags: rawFlags} = await this.parse(Query)
    const flags = rawFlags as QueryFlags
    const format = (flags.format ?? 'text') as 'json' | 'text'
    const headless = flags.headless ?? false

    await this.createUseCase({format, headless}).run({
      format,
      headless,
      query: args.query,
      verbose: flags.verbose,
    })
  }
}
