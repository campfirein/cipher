import {Args, Command, Flags} from '@oclif/core'

import {isDevelopment} from '../../server/config/environment.js'
import {IQueryUseCase} from '../../server/core/interfaces/usecase/i-query-use-case.js'
import {HeadlessTerminal} from '../../server/infra/terminal/headless-terminal.js'
import {QueryUseCase} from '../../server/infra/usecase/query-use-case.js'

/** Parsed flags type */
type QueryFlags = {
  format?: 'json' | 'text'
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
    '# JSON output (for automation)',
    '<%= config.bin %> <%= command.id %> "How does auth work?" --format json',
  ]
  public static flags = {
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
  public static strict = false

  protected createUseCase(options: {format: 'json' | 'text'}): IQueryUseCase {
    const terminal = new HeadlessTerminal({failOnPrompt: true, outputFormat: options.format})

    return new QueryUseCase({
      terminal,
    })
  }

  public async run(): Promise<void> {
    const {args, flags: rawFlags} = await this.parse(Query)
    const flags = rawFlags as QueryFlags
    const format = (flags.format ?? 'text') as 'json' | 'text'

    await this.createUseCase({format}).run({
      format,
      query: args.query,
      verbose: flags.verbose,
    })
  }
}
