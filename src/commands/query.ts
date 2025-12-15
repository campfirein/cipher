import {Args, Command, Flags} from '@oclif/core'

import type {IQueryUseCase} from '../core/interfaces/usecase/i-query-use-case.js'

import {isDevelopment} from '../config/environment.js'
import {ProjectConfigStore} from '../infra/config/file-config-store.js'
import {FileGlobalConfigStore} from '../infra/storage/file-global-config-store.js'
import {KeychainTokenStore} from '../infra/storage/keychain-token-store.js'
import {OclifTerminal} from '../infra/terminal/oclif-terminal.js'
import {MixpanelTrackingService} from '../infra/tracking/mixpanel-tracking-service.js'
import {QueryUseCase} from '../infra/usecase/query-use-case.js'

export default class Query extends Command {
  public static args = {
    query: Args.string({
      description: 'Natural language question about your codebase or project knowledge',
      required: true,
    }),
  }
  public static description = `Query and retrieve information from the context tree
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
    ...(isDevelopment()
      ? [
          '# Query with OpenRouter (development only)',
          '<%= config.bin %> <%= command.id %> -k YOUR_API_KEY Show me all API endpoints',
          '',
          '# Query with custom model (development only)',
          '<%= config.bin %> <%= command.id %> -k YOUR_API_KEY -m anthropic/claude-sonnet-4 Explain the database schema',
          '',
          '# Query with verbose output (development only)',
          '<%= config.bin %> <%= command.id %> -v What testing strategies are used?',
        ]
      : []),
  ]
  public static flags = {
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
  public static strict = false

  protected createUseCase(): IQueryUseCase {
    const tokenStore = new KeychainTokenStore()
    const globalConfigStore = new FileGlobalConfigStore()
    return new QueryUseCase({
      projectConfigStore: new ProjectConfigStore(),
      terminal: new OclifTerminal(this),
      tokenStore,
      trackingService: new MixpanelTrackingService({globalConfigStore, tokenStore}),
    })
  }

  public async run(): Promise<void> {
    const {argv, flags} = await this.parse(Query)
    const queryTerms = argv.join(' ')

    await this.createUseCase().run({
      apiKey: flags.apiKey,
      model: flags.model,
      query: queryTerms,
      verbose: flags.verbose ?? false,
    })
  }
}
