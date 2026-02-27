import React from 'react'

import type {SlashCommand} from '../../../types/commands.js'

import {LogoutFlow} from '../../auth/components/logout-flow.js'
import {Flags, parseReplArgs, toCommandFlags} from '../utils/arg-parser.js'

const logoutFlags = {
  yes: Flags.boolean({
    char: 'y',
    default: false,
    description: 'Skip confirmation prompt',
  }),
}

export const logoutCommand: SlashCommand = {
  async action(_context, args) {
    const parsed = await parseReplArgs(args, {flags: logoutFlags, strict: false})
    const skipConfirm = parsed.flags.yes ?? false

    return {
      render: ({onCancel, onComplete}) =>
        React.createElement(LogoutFlow, {
          onCancel,
          onComplete: (message: string) => onComplete(message, {reloadAuth: true}),
          skipConfirm,
        }),
    }
  },
  description: 'Disconnect from ByteRover cloud and clear credentials',
  flags: toCommandFlags(logoutFlags),
  name: 'logout',
}
