import React from 'react'

import type {SlashCommand} from '../../../types/commands.js'

import {ResetFlow} from '../../reset/components/reset-flow.js'
import {Flags, parseReplArgs, toCommandFlags} from '../utils/arg-parser.js'

const resetFlags = {
  yes: Flags.boolean({
    char: 'y',
    default: false,
    description: 'Skip confirmation prompt',
  }),
}

export const resetCommand: SlashCommand = {
  async action(_context, args) {
    const parsed = await parseReplArgs(args, {flags: resetFlags, strict: false})
    const skipConfirm = parsed.flags.yes ?? false

    return {
      render: ({onCancel, onComplete}) => React.createElement(ResetFlow, {onCancel, onComplete, skipConfirm}),
    }
  },
  description: 'Reset the current context tree to an empty state',
  flags: toCommandFlags(resetFlags),
  name: 'reset',
}
