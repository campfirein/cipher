import {resolve} from 'node:path'

import type {SlashCommand} from '../../../types/commands.js'

import {addSourceViaTransport} from '../../source/api/source-api.js'
import {Flags, parseReplArgs, toCommandFlags} from '../utils/arg-parser.js'

const sourceAddFlags = {
  alias: Flags.string({
    description: 'Custom alias for the source (defaults to directory name)',
  }),
}

export const sourceAddSubCommand: SlashCommand = {
  async action(_context, args) {
    const parsed = await parseReplArgs(args ?? '', {flags: sourceAddFlags, strict: false})

    const targetArg = parsed.argv[0]
    if (!targetArg) {
      return {
        content: 'Usage: /source add <path-to-project> [--alias <name>]',
        messageType: 'error' as const,
        type: 'message' as const,
      }
    }

    const targetPath = resolve(targetArg)

    try {
      const result = await addSourceViaTransport(targetPath, parsed.flags.alias)

      return {
        content: result.message,
        messageType: result.success ? ('info' as const) : ('error' as const),
        type: 'message' as const,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        content: `Source add failed: ${message}`,
        messageType: 'error' as const,
        type: 'message' as const,
      }
    }
  },
  args: [
    {
      description: 'Path to the target project containing .brv/',
      name: 'path',
      required: true,
    },
  ],
  description: "Add a read-only knowledge source from another project's context tree",
  flags: toCommandFlags(sourceAddFlags),
  name: 'add',
}
