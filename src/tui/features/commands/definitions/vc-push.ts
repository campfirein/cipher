import React from 'react'

import type {SlashCommand} from '../../../types/commands.js'

import {VcPushFlow} from '../../vc/push/components/vc-push-flow.js'
import {Flags, parseReplArgs, toCommandFlags} from '../utils/arg-parser.js'

const vcPushFlags = {
  branch: Flags.string({char: 'b', description: 'Branch to push to (default: current branch)'}),
}

export const vcPushSubCommand: SlashCommand = {
  async action(_context, rawArgs) {
    const parsed = await parseReplArgs(rawArgs, {flags: vcPushFlags, strict: false})
    const {branch} = parsed.flags

    return {
      render: ({onCancel, onComplete}) => React.createElement(VcPushFlow, {branch, onCancel, onComplete}),
    }
  },
  description: 'Push commits to ByteRover cloud',
  flags: toCommandFlags(vcPushFlags),
  name: 'push',
}
