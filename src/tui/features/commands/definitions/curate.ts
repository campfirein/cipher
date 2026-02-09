import React from 'react'

import type {SlashCommand} from '../../../types/commands.js'

import {isDevelopment} from '../../../lib/environment.js'
import {CurateFlow} from '../../curate/components/curate-flow.js'
import {Flags, parseReplArgs, toCommandFlags} from '../utils/arg-parser.js'

const devFlags = {
  apiKey: Flags.string({char: 'k', description: 'OpenRouter API key [Dev only]'}),
  model: Flags.string({char: 'm', description: 'Model to use [Dev only]'}),
  verbose: Flags.boolean({char: 'v', description: 'Enable verbose debug output [Dev only]'}),
}

export const curateCommand: SlashCommand = {
  async action(context, args) {
    const files = context.invocation?.files ?? []

    let contextText: string | undefined
    let flags: {apiKey?: string; model?: string; verbose?: boolean} = {}

    if (isDevelopment()) {
      const parsed = await parseReplArgs(args, {flags: devFlags, strict: false})
      contextText = parsed.argv.join(' ') || undefined
      flags = parsed.flags
    } else {
      contextText = args || undefined
    }

    return {
      render: ({onCancel, onComplete}) =>
        React.createElement(CurateFlow, {
          context: contextText,
          files: files.length > 0 ? files : undefined,
          flags,
          onCancel,
          onComplete,
        }),
    }
  },
  args: [
    {
      description: 'Knowledge context (optional, triggers autonomous mode)',
      name: 'context',
      required: false,
    },
  ],
  description: 'Curate context to the context tree.',
  flags: [
    {
      char: '@',
      description: 'Include files (type @ to browse, max 5)',
      name: 'file',
      type: 'file',
    },
    ...(isDevelopment() ? toCommandFlags(devFlags) : []),
  ],
  name: 'curate',
}
