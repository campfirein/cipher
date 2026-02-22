import React from 'react'

import type {SlashCommand} from '../../../types/commands.js'

import {SpaceListView} from '../../space/components/space-list-view.js'
import {Flags, parseReplArgs, toCommandFlags} from '../utils/arg-parser.js'

const listFlags = {
  json: Flags.boolean({
    char: 'j',
    default: false,
    description: 'Output in JSON format',
  }),
}

export const spaceListCommand: SlashCommand = {
  async action(_context, args) {
    const parsed = await parseReplArgs(args, {flags: listFlags, strict: false})
    const json = parsed.flags.json ?? false

    return {
      render: ({onCancel, onComplete}) => React.createElement(SpaceListView, {json, onCancel, onComplete}),
    }
  },
  description: 'List all spaces for the current team',
  flags: toCommandFlags(listFlags),
  name: 'list',
}
