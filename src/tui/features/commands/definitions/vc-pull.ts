import React from 'react'

import type {SlashCommand} from '../../../types/commands.js'

import {VcPullFlow} from '../../vc/pull/components/vc-pull-flow.js'
import {Flags, parseReplArgs, toCommandFlags} from '../utils/arg-parser.js'

const vcPullFlags = {
  branch: Flags.string({char: 'b', description: 'Branch to pull from (default: current branch)'}),
}

export const vcPullSubCommand: SlashCommand = {
  async action(_context, rawArgs) {
    const parsed = await parseReplArgs(rawArgs, {flags: vcPullFlags, strict: false})
    const {branch} = parsed.flags

    return {
      render: ({onCancel, onComplete}) => React.createElement(VcPullFlow, {branch, onCancel, onComplete}),
    }
  },
  description: 'Pull commits from ByteRover cloud',
  flags: toCommandFlags(vcPullFlags),
  name: 'pull',
}
