import React from 'react'

import type {MessageActionReturn, SlashCommand} from '../../../types/commands.js'

import {VcPullFlow} from '../../vc/pull/components/vc-pull-flow.js'
import {Args, Flags, parseReplArgs, toCommandFlags} from '../utils/arg-parser.js'

/* eslint-disable perfectionist/sort-objects -- positional order matters: remote before branch */
const vcPullArgs = {
  remote: Args.string({description: 'Remote name (only origin supported)'}),
  branch: Args.string({description: 'Branch to pull'}),
}
/* eslint-enable perfectionist/sort-objects */

const vcPullFlags = {
  'allow-unrelated-histories': Flags.boolean({default: false, description: 'Allow merging unrelated histories'}),
}

export const vcPullSubCommand: SlashCommand = {
  async action(_context, rawArgs) {
    const parsed = await parseReplArgs(rawArgs, {args: vcPullArgs, flags: vcPullFlags, strict: false})
    const {branch, remote} = parsed.args

    if (remote && remote !== 'origin') {
      const errorMsg: MessageActionReturn = {
        content: `Only 'origin' remote is currently supported.`,
        messageType: 'error',
        type: 'message',
      }
      return errorMsg
    }

    return {
      render: ({onCancel, onComplete}) =>
        React.createElement(VcPullFlow, {
          allowUnrelatedHistories: parsed.flags['allow-unrelated-histories'],
          branch,
          onCancel,
          onComplete,
          remote,
        }),
    }
  },
  args: [
    {description: 'Remote name (only origin supported)', name: 'remote', required: false},
    {description: 'Branch to pull', name: 'branch', required: false},
  ],
  description: 'Pull commits from ByteRover cloud',
  flags: toCommandFlags(vcPullFlags),
  name: 'pull',
}
