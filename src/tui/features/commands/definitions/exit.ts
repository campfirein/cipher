import React from 'react'

import type {SlashCommand} from '../../../types/commands.js'

import {ExitFlow} from '../../exit/components/exit-flow.js'

export const exitCommand: SlashCommand = {
  action: () => ({
    render: ({onComplete}) => React.createElement(ExitFlow, {onComplete}),
  }),
  description: 'Exit the ByteRover REPL',
  name: 'exit',
}
