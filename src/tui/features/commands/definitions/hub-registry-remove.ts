import React from 'react'

import type {SlashCommand} from '../../../types/commands.js'

import {HubRegistryRemoveView} from '../../hub/components/hub-registry-remove-view.js'
import {Args, parseReplArgs} from '../utils/arg-parser.js'

const removeArgs = {
  name: Args.string({description: 'Registry name', required: true}),
}

export const hubRegistryRemoveCommand: SlashCommand = {
  async action(_context, args) {
    const parsed = await parseReplArgs(args, {args: removeArgs, strict: false})
    const name = parsed.args.name as string | undefined

    if (!name) {
      return {
        content: 'Usage: /hub registry remove <name>',
        messageType: 'error' as const,
        type: 'message' as const,
      }
    }

    return {
      render: ({onCancel, onComplete}) =>
        React.createElement(HubRegistryRemoveView, {name, onCancel, onComplete}),
    }
  },
  args: [{description: 'Registry name', name: 'name', required: true}],
  description: 'Remove a private registry',
  name: 'remove',
}
