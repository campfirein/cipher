import {isDevelopment} from '../../config/environment.js'
import {FileGlobalConfigStore} from '../../infra/storage/file-global-config-store.js'
import {createTokenStore} from '../../infra/storage/token-store.js'
import {ReplTerminal} from '../../infra/terminal/repl-terminal.js'
import {MixpanelTrackingService} from '../../infra/tracking/mixpanel-tracking-service.js'
import {QueryUseCase} from '../../infra/usecase/query-use-case.js'
import {CommandContext, CommandKind, SlashCommand} from '../types.js'
import {Flags, parseReplArgs, toCommandFlags} from './arg-parser.js'

// Dev-only flags - defined once, used for both parsing and help display
const devFlags = {
  apiKey: Flags.string({char: 'k', description: 'OpenRouter API key [Dev only]'}),
  model: Flags.string({char: 'm', description: 'Model to use [Dev only]'}),
  verbose: Flags.boolean({char: 'v', description: 'Enable verbose debug output [Dev only]'}),
}

/**
 * Query command - Query and retrieve information from the context tree
 */
export const queryCommand: SlashCommand = {
  action(_context: CommandContext, args: string) {
    return {
      async execute(onMessage, onPrompt) {
        // Parse flags only in dev mode, otherwise use args directly as query
        let query: string
        let flags: {apiKey?: string; model?: string; verbose?: boolean} = {}

        if (isDevelopment()) {
          const parsed = await parseReplArgs(args, {flags: devFlags, strict: false})
          query = parsed.argv.join(' ')
          flags = parsed.flags
        } else {
          query = args
        }

        const terminal = new ReplTerminal({onMessage, onPrompt})
        const tokenStore = createTokenStore()
        const globalConfigStore = new FileGlobalConfigStore()

        const useCase = new QueryUseCase({
          terminal,
          trackingService: new MixpanelTrackingService({globalConfigStore, tokenStore}),
        })

        await useCase.run({
          apiKey: flags.apiKey,
          model: flags.model,
          query,
          verbose: Boolean(flags.verbose),
        })
      },
      type: 'streaming' as const,
    }
  },
  aliases: ['q'],
  args: [
    {
      description: `Natural language question about your codebase or project knowledge.

Ask specific questions for better results. The query system will:
- Search your curated context tree for relevant information
- Analyze the query from multiple perspectives for comprehensive results
- Synthesize findings into a clear, cited answer

EXAMPLES:
  /query How is authentication implemented?
  /query What are the API error handling patterns?
  /query Explain the database schema design decisions
  /query What testing strategies are used in this project?

TIPS:
  - Be specific: "How does JWT refresh work?" vs "authentication"
  - Add context: "in the API layer" or "for user management"
  - Ask about patterns, decisions, or implementations`,
      name: 'query',
      required: true,
    },
  ],
  autoExecute: false,
  description: `Query and retrieve information from the context tree.

Searches your curated knowledge base using natural language. Complex queries
are automatically analyzed from multiple perspectives to find comprehensive
answers with file citations.`,
  flags: isDevelopment() ? toCommandFlags(devFlags) : [],
  kind: CommandKind.BUILT_IN,
  name: 'query',
}
