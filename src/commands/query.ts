import {Args, Command, Flags} from '@oclif/core'

import {isDevelopment} from '../config/environment.js'
import {IQueryUseCase} from '../core/interfaces/usecase/i-query-use-case.js'
import {FileGlobalConfigStore} from '../infra/storage/file-global-config-store.js'
import {createTokenStore} from '../infra/storage/token-store.js'
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
  public static description = `Query and retrieve information from the context tree (connects to running brv instance)

Requires a running brv instance. Start one with: brv start

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
  ]
  public static flags = {
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

  protected createUseCase(): IQueryUseCase {
    const tokenStore = createTokenStore()
    const globalConfigStore = new FileGlobalConfigStore()
    const trackingService = new MixpanelTrackingService({globalConfigStore, tokenStore})

    return new QueryUseCase({
      terminal: new OclifTerminal(this),
      trackingService,
    })
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(Query)
    await this.createUseCase().run({query: args.query, verbose: flags.verbose})
  }
}
