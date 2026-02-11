import React from 'react'

import type {SlashCommand} from '../../../types/commands.js'

import {NewSessionFlow} from '../../session/components/new-session-flow.js'
import {Flags, parseReplArgs, toCommandFlags} from '../utils/arg-parser.js'

const newFlags = {
  yes: Flags.boolean({
    char: 'y',
    default: false,
    description: 'Skip confirmation prompt',
  }),
}

export const newCommand: SlashCommand = {
  async action(_context, args) {
    const parsed = await parseReplArgs(args, {flags: newFlags, strict: false})
    const skipConfirm = parsed.flags.yes ?? false

    return {
      render: ({onCancel, onComplete}) =>
        React.createElement(NewSessionFlow, {
          onCancel,
          onComplete: (message: string) => onComplete(message, {clearSession: true}),
          skipConfirm,
        }),
    }
  },
  args: [],
  description: 'Start a fresh session (ends current session, clears conversation)',
  flags: toCommandFlags(newFlags),
  name: 'new',
}
