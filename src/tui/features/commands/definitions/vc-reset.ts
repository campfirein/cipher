import React from 'react'

import type {SlashCommand} from '../../../types/commands.js'

import {VcResetFlow} from '../../vc/reset/components/vc-reset-flow.js'
import {Flags, parseReplArgs, toCommandFlags} from '../utils/arg-parser.js'

const vcResetFlags = {
  hard: Flags.boolean({description: 'Reset HEAD, index, and working tree', exclusive: ['soft']}),
  soft: Flags.boolean({description: 'Reset HEAD only, keep changes staged', exclusive: ['hard']}),
}

export const vcResetSubCommand: SlashCommand = {
  async action(_context, rawArgs) {
    const parsed = await parseReplArgs(rawArgs, {flags: vcResetFlags, strict: false})
    const {hard, soft} = parsed.flags
    const args = parsed.argv.filter((a): a is string => typeof a === 'string')

    // When --soft or --hard is set, first arg is the optional ref (default HEAD)
    const mode = soft ? 'soft' : hard ? 'hard' : undefined
    const ref = mode ? args[0] : undefined
    const filePaths = mode ? undefined : (args.length > 0 ? args : undefined)

    if (filePaths) {
      return {
        render: ({onCancel, onComplete}) =>
          React.createElement(VcResetFlow, {filePaths, onCancel, onComplete}),
      }
    }

    if (mode) {
      return {
        render: ({onCancel, onComplete}) =>
          React.createElement(VcResetFlow, {mode, onCancel, onComplete, ref}),
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
