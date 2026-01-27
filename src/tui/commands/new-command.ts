import {ReplTerminal} from '../../infra/terminal/repl-terminal.js'
import {CommandContext, CommandKind, SlashCommand} from '../types.js'
import {Flags, parseReplArgs, toCommandFlags} from './arg-parser.js'

// Flags - defined once, used for both parsing and help display
const newFlags = {
  yes: Flags.boolean({
    char: 'y',
    default: false,
    description: 'Skip confirmation prompt',
  }),
}

// Args - no args needed
const newArgs = {}

/**
 * /new command - Start a fresh session.
 *
 * This command:
 * 1. Marks the current session as 'ended'
 * 2. Creates a new session ID
 * 3. Updates the active session pointer
 * 4. Clears conversation history from the TUI view
 *
 * Note: This command does NOT affect the context tree (use /clear for that).
 * The actual session switching is handled by command-view.tsx after this command executes.
 */
export const newCommand: SlashCommand = {
  action(_context: CommandContext, args: string) {
    return {
      async execute(onMessage, onPrompt) {
        const terminal = new ReplTerminal({onMessage, onPrompt})

        const parsed = await parseReplArgs(args, {
          args: newArgs,
          flags: newFlags,
          strict: false,
        })

        // Show confirmation unless -y flag is passed
        if (!parsed.flags.yes) {
          const confirmed = await terminal.confirm({
            default: false,
            message: 'Start a new session (ends current session and clears conversation history)',
          })

          if (!confirmed) {
            terminal.log('Cancelled.')
            return
          }
        }

        terminal.log('Starting new session...')
        // The actual session creation is handled by command-view.tsx
        // after this command completes. It sends agent:newSession event.
      },
      type: 'streaming',
    }
  },
  aliases: [],
  args: [],
  autoExecute: true,
  description: 'Start a fresh session (ends current session, clears conversation)',
  flags: toCommandFlags(newFlags),
  kind: CommandKind.BUILT_IN,
  name: 'new',
}
