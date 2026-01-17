import {type CommandContext, CommandKind, type SlashCommand} from '../../../tui/types.js'
import {FileContextTreeService} from '../../context-tree/file-context-tree-service.js'
import {FileContextTreeSnapshotService} from '../../context-tree/file-context-tree-snapshot-service.js'
import {ReplTerminal} from '../../terminal/repl-terminal.js'
import {ResetUseCase} from '../../usecase/reset-use-case.js'
import {Args, Flags, parseReplArgs, toCommandFlags} from './arg-parser.js'

// Flags - defined once, used for both parsing and help display
const resetFlags = {
  yes: Flags.boolean({
    char: 'y',
    default: false,
    description: 'Skip confirmation prompt',
  }),
}

// Args - defined once for parsing
const resetArgs = {
  directory: Args.string({
    description: 'Project directory (defaults to current directory)',
    required: false,
  }),
}

/**
 * reset command
 */
export const resetCommand: SlashCommand = {
  action(_context: CommandContext, args: string) {
    return {
      async execute(onMessage, onPrompt) {
        const terminal = new ReplTerminal({onMessage, onPrompt})

        const parsed = await parseReplArgs(args, {
          args: resetArgs,
          flags: resetFlags,
          strict: false,
        })

        const useCase = new ResetUseCase({
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
  description: 'Reset the current context tree to an empty state',
  flags: toCommandFlags(resetFlags),
  kind: CommandKind.BUILT_IN,
  name: 'reset',
}
