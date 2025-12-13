import {Args, Flags, Parser} from '@oclif/core'

import {type CommandContext, CommandKind, type SlashCommand} from '../../../tui/types.js'
import {FileContextTreeService} from '../../context-tree/file-context-tree-service.js'
import {FileContextTreeSnapshotService} from '../../context-tree/file-context-tree-snapshot-service.js'
import {ReplTerminal} from '../../terminal/repl-terminal.js'
import {ResetUseCase} from '../../usecase/reset-use-case.js'

export const resetCommandFlags = {
  yes: Flags.boolean({
    char: 'y',
    default: false,
    description: 'Skip confirmation prompt',
  }),
}

export const resetCommandArgs = {
  directory: Args.string({
    description: 'Project directory (defaults to current directory)',
    required: false,
  }),
}

/**
 * Reset command
 */
export const resetCommand: SlashCommand = {
  action(_context: CommandContext, args: string) {
    return {
      async execute(onMessage, onPrompt) {
        const terminal = new ReplTerminal({onMessage, onPrompt})

        const argv = args.split(/\s+/).filter(Boolean)
        const parsed = await Parser.parse(argv, {
          args: resetCommandArgs,
          flags: resetCommandFlags,
          strict: false,
        })

        const useCase = new ResetUseCase({
          contextTreeService: new FileContextTreeService(),
          contextTreeSnapshotService: new FileContextTreeSnapshotService(),
          terminal,
        })

        await useCase.run({
          directory: parsed.args.directory,
          skipConfirmation: parsed.flags.yes,
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
  flags: [
    {
      char: 'y',
      default: false,
      description: 'Skip confirmation prompt',
      name: 'yes',
      type: 'boolean',
    },
  ],
  kind: CommandKind.BUILT_IN,
  name: 'reset',
}
