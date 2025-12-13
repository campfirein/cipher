import {type CommandContext, CommandKind, type SlashCommand} from '../../../tui/types.js'
import {FileContextTreeService} from '../../context-tree/file-context-tree-service.js'
import {FileContextTreeSnapshotService} from '../../context-tree/file-context-tree-snapshot-service.js'
import {ReplTerminal} from '../../terminal/repl-terminal.js'
import {ClearUseCase} from '../../usecase/clear-use-case.js'
import {Args, Flags, parseReplArgs, toCommandFlags} from './arg-parser.js'

// Flags - defined once, used for both parsing and help display
const clearFlags = {
  yes: Flags.boolean({
    char: 'y',
    default: false,
    description: 'Skip confirmation prompt',
  }),
}

// Args - defined once for parsing
const clearArgs = {
  directory: Args.string({
    description: 'Project directory (defaults to current directory)',
    required: false,
  }),
}

/**
 * clear command
 */
export const clearCommand: SlashCommand = {
  action(_context: CommandContext, args: string) {
    return {
      async execute(onMessage, onPrompt) {
        const terminal = new ReplTerminal({onMessage, onPrompt})

        const parsed = await parseReplArgs(args, {
          args: clearArgs,
          flags: clearFlags,
          strict: false,
        })

        const useCase = new ClearUseCase({
          contextTreeService: new FileContextTreeService(),
          contextTreeSnapshotService: new FileContextTreeSnapshotService(),
          terminal,
        })

        await useCase.run({
          directory: parsed.args.directory,
          skipConfirmation: parsed.flags.yes ?? false,
        })
      },
      type: 'streaming',
    }
  },
  aliases: [],
  args: [
    {
      description: 'Project directory (defaults to current directory)',
      name: 'directory',
      required: false,
    },
  ],
  autoExecute: true,
  description: 'Reset the current context tree and start with 6 default domains',
  flags: toCommandFlags(clearFlags),
  kind: CommandKind.BUILT_IN,
  name: 'clear',
}
