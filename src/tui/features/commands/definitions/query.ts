import React from 'react'

import type {SlashCommand} from '../../../types/commands.js'

import {isDevelopment} from '../../../lib/environment.js'
import {QueryFlow} from '../../query/components/query-flow.js'
import {Flags, parseReplArgs, toCommandFlags} from '../utils/arg-parser.js'

const devFlags = {
  apiKey: Flags.string({char: 'k', description: 'OpenRouter API key [Dev only]'}),
  model: Flags.string({char: 'm', description: 'Model to use [Dev only]'}),
  verbose: Flags.boolean({char: 'v', description: 'Enable verbose debug output [Dev only]'}),
}

export const queryCommand: SlashCommand = {
  async action(_context, args) {
    let query: string
    let flags: {apiKey?: string; model?: string; verbose?: boolean} = {}

    if (isDevelopment()) {
      const parsed = await parseReplArgs(args, {flags: devFlags, strict: false})
      query = parsed.argv.join(' ')
      flags = parsed.flags
    } else {
      query = args
    }

    return {
      render: ({onCancel, onComplete}) => React.createElement(QueryFlow, {flags, onCancel, onComplete, query}),
    }
  },
  args: [
    {
      description: 'Natural language question about your codebase or project knowledge.',
      name: 'query',
      required: true,
    },
  ],
  description: 'Query and retrieve information from the context tree.',
  flags: isDevelopment() ? toCommandFlags(devFlags) : [],
  name: 'query',
}
