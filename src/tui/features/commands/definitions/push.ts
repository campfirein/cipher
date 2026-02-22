import React from 'react'

import type {SlashCommand} from '../../../types/commands.js'

import {PushFlow} from '../../push/components/push-flow.js'
import {Flags, parseReplArgs, toCommandFlags} from '../utils/arg-parser.js'

const DEFAULT_BRANCH = 'main'

const pushFlags = {
  branch: Flags.string({
    char: 'b',
    default: DEFAULT_BRANCH,
    description: 'ByteRover branch name (not Git branch)',
  }),
  yes: Flags.boolean({
    char: 'y',
    default: false,
    description: 'Skip confirmation prompt',
  }),
}

export const pushCommand: SlashCommand = {
  async action(_context, args) {
    const parsed = await parseReplArgs(args, {flags: pushFlags, strict: false})
    const branch = parsed.flags.branch ?? DEFAULT_BRANCH
    const skipConfirm = parsed.flags.yes ?? false

    return {
      render: ({onCancel, onComplete}) => React.createElement(PushFlow, {branch, onCancel, onComplete, skipConfirm}),
    }
  },
  description: 'Push context tree to ByteRover memory storage',
  flags: toCommandFlags(pushFlags),
  name: 'push',
}
