import React from 'react'

import type {MessageActionReturn, SlashCommand} from '../../../types/commands.js'

import {VcMergeFlow} from '../../vc/merge/components/vc-merge-flow.js'
import {Flags, parseReplArgs, toCommandFlags} from '../utils/arg-parser.js'

const vcMergeFlags = {
  abort: Flags.boolean({description: 'Abort the current merge', exclusive: ['continue']}),
  'allow-unrelated-histories': Flags.boolean({default: false, description: 'Allow merging unrelated histories'}),
  continue: Flags.boolean({description: 'Continue after resolving conflicts', exclusive: ['abort']}),
  message: Flags.string({char: 'm', description: 'Merge commit message'}),
}

export const vcMergeSubCommand: SlashCommand = {
  async action(_context, rawArgs) {
    const parsed = await parseReplArgs(rawArgs, {flags: vcMergeFlags, strict: false})
    const {abort, continue: cont, message} = parsed.flags
    const branch = parsed.argv[0] as string | undefined

    if (abort) {
      return {
        render: ({onCancel, onComplete}) =>
          React.createElement(VcMergeFlow, {action: 'abort', onCancel, onComplete}),
      }
    }

    if (cont) {
      return {
        render: ({onCancel, onComplete}) =>
          React.createElement(VcMergeFlow, {action: 'continue', message, onCancel, onComplete}),
      }
    }

    if (!branch) {
      const errorMsg: MessageActionReturn = {
        content: 'Usage: /vc merge <branch> | --abort | --continue',
        messageType: 'error',
        type: 'message',
      }
      return errorMsg
    }

    return {
      render: ({onCancel, onComplete}) =>
        React.createElement(VcMergeFlow, {
          action: 'merge',
          allowUnrelatedHistories: parsed.flags['allow-unrelated-histories'],
          branch,
          message,
          onCancel,
          onComplete,
        }),
    }
  },
  args: [{description: 'Branch to merge', name: 'branch', required: false}],
  description: 'Merge a branch into the current branch',
  flags: toCommandFlags(vcMergeFlags),
  name: 'merge',
}
