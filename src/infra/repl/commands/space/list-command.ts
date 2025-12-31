import {getCurrentConfig} from '../../../../config/environment.js'
import {type CommandContext, CommandKind, type SlashCommand} from '../../../../tui/types.js'
import {ProjectConfigStore} from '../../../config/file-config-store.js'
import {HttpSpaceService} from '../../../space/http-space-service.js'
import {createTokenStore} from '../../../storage/token-store.js'
import {ReplTerminal} from '../../../terminal/repl-terminal.js'
import {SpaceListUseCase} from '../../../usecase/space-list-use-case.js'
import {Flags, parseReplArgs, toCommandFlags} from '../arg-parser.js'

const DEFAULT_LIMIT = 50
const DEFAULT_OFFSET = 0

// Flags - defined once, used for both parsing and help display
const listFlags = {
  all: Flags.boolean({
    char: 'a',
    default: false,
    description: 'Fetch all spaces (may be slow for large teams)',
  }),
  json: Flags.boolean({
    char: 'j',
    default: false,
    description: 'Output in JSON format',
  }),
  limit: Flags.integer({
    char: 'l',
    default: DEFAULT_LIMIT,
    description: 'Maximum number of spaces to fetch',
  }),
  offset: Flags.integer({
    char: 'o',
    default: DEFAULT_OFFSET,
    description: 'Number of spaces to skip',
  }),
}

/**
 * List spaces command
 */
export const listCommand: SlashCommand = {
  action(_context: CommandContext, args: string) {
    return {
      async execute(onMessage, onPrompt) {
        const terminal = new ReplTerminal({onMessage, onPrompt})

        const parsed = await parseReplArgs(args, {
          flags: listFlags,
          strict: false,
        })

        const envConfig = getCurrentConfig()
        const useCase = new SpaceListUseCase({
          flags: {
            all: parsed.flags.all ?? false,
            json: parsed.flags.json ?? false,
            limit: Number(parsed.flags.limit ?? DEFAULT_LIMIT),
            offset: Number(parsed.flags.offset ?? DEFAULT_OFFSET),
          },
          projectConfigStore: new ProjectConfigStore(),
          spaceService: new HttpSpaceService({apiBaseUrl: envConfig.apiBaseUrl}),
          terminal,
          tokenStore: createTokenStore(),
        })

        await useCase.run()
      },
      type: 'streaming',
    }
  },
  aliases: [],
  autoExecute: true,
  description: 'List all spaces for the current team',
  flags: toCommandFlags(listFlags),
  kind: CommandKind.BUILT_IN,
  name: 'list',
}
