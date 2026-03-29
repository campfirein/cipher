import React from 'react'

import type {SlashCommand} from '../../../types/commands.js'

import {VcResetFlow} from '../../vc/reset/components/vc-reset-flow.js'
import {Flags, parseReplArgs, toCommandFlags} from '../utils/arg-parser.js'

const vcResetFlags = {
  hard: Flags.string({description: 'Reset HEAD, index, and working tree to the given ref', exclusive: ['soft']}),
  soft: Flags.string({description: 'Reset HEAD only, keep changes staged', exclusive: ['hard']}),
}

export const vcResetSubCommand: SlashCommand = {
  async action(_context, rawArgs) {
    const parsed = await parseReplArgs(rawArgs, {flags: vcResetFlags, strict: false})
    const {hard, soft} = parsed.flags
    const filePaths = parsed.argv.length > 0
      ? parsed.argv.filter((a): a is string => typeof a === 'string')
      : undefined

    if (filePaths) {
      return {
        render: ({onCancel, onComplete}) =>
          React.createElement(VcResetFlow, {filePaths, onCancel, onComplete}),
      }
    }

    if (soft) {
      return {
        render: ({onCancel, onComplete}) =>
          React.createElement(VcResetFlow, {mode: 'soft', onCancel, onComplete, ref: soft}),
      }
    }

    if (hard) {
      return {
        render: ({onCancel, onComplete}) =>
          React.createElement(VcResetFlow, {mode: 'hard', onCancel, onComplete, ref: hard}),
      }
    }

    return {
      render: ({onCancel, onComplete}) =>
        React.createElement(VcResetFlow, {onCancel, onComplete}),
    }
  },
  args: [{description: 'File paths to unstage', name: 'files', required: false}],
  description: 'Unstage files or undo commits',
  flags: toCommandFlags(vcResetFlags),
  name: 'reset',
}
