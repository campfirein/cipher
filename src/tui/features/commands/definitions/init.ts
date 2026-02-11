import React from 'react'

import type {SlashCommand} from '../../../types/commands.js'

import {InitFlow} from '../../init/components/init-flow.js'
import {Flags, parseReplArgs, toCommandFlags} from '../utils/arg-parser.js'

const initFlags = {
  force: Flags.boolean({char: 'f', description: 'Force re-initialization without confirmation prompt'}),
}

export const initCommand: SlashCommand = {
  async action(_context, args) {
    const parsed = await parseReplArgs(args, {flags: initFlags})
    const force = parsed.flags.force ?? false

    return {
      render: ({onCancel, onComplete}) => React.createElement(InitFlow, {force, onCancel, onComplete}),
    }
  },
  description: 'Initialize a project with ByteRover',
  flags: toCommandFlags(initFlags),
  name: 'init',
}
