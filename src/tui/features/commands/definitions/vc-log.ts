import React from 'react'

import type {SlashCommand} from '../../../types/commands.js'

import {LogFlow} from '../../log/components/log-flow.js'
import {Args, Flags, parseReplArgs, toCommandFlags} from '../utils/arg-parser.js'

const vcLogArgs = {
  branch: Args.string({description: 'Branch name to show history for'}),
}

const vcLogFlags = {
  all: Flags.boolean({char: 'a', default: false, description: 'Show commits from all branches'}),
  limit: Flags.string({default: '10', description: 'Number of commits to show (default: 10)'}),
}

export const vcLogSubCommand: SlashCommand = {
  async action(_context, args) {
    const parsed = await parseReplArgs(args, {args: vcLogArgs, flags: vcLogFlags, strict: false})
    const limit = Number(parsed.flags.limit ?? '10')
    const all = parsed.flags.all ?? false
    const {branch} = parsed.args

    return {
      render: ({onCancel, onComplete}) => React.createElement(LogFlow, {all, branch, limit, onCancel, onComplete}),
    }
  },
  args: [{description: 'Branch name to show history for', name: 'branch'}],
  description: 'Show commit history for the context-tree',
  flags: toCommandFlags(vcLogFlags),
  name: 'log',
}
