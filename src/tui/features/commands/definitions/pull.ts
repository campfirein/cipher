import React from 'react'

import type {SlashCommand} from '../../../types/commands.js'

import {PullFlow} from '../../pull/components/pull-flow.js'
import {Flags, parseReplArgs, toCommandFlags} from '../utils/arg-parser.js'

const DEFAULT_BRANCH = 'main'

const pullFlags = {
  branch: Flags.string({
    char: 'b',
    default: DEFAULT_BRANCH,
    description: 'ByteRover branch name (not Git branch)',
  }),
}

export const pullCommand: SlashCommand = {
  async action(_context, args) {
    const parsed = await parseReplArgs(args, {flags: pullFlags, strict: false})
    const branch = parsed.flags.branch ?? DEFAULT_BRANCH

    return {
      render: ({onCancel, onComplete}) => React.createElement(PullFlow, {branch, onCancel, onComplete}),
    }
  },
  description: 'Pull context tree from ByteRover memory storage',
  flags: toCommandFlags(pullFlags),
  name: 'pull',
}
