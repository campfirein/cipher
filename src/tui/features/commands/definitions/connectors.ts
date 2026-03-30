import React from 'react'

import type {SlashCommand} from '../../../types/commands.js'

import {ConnectorsFlow} from '../../connectors/components/connectors-flow.js'

export const connectorsCommand: SlashCommand = {
  action: () => ({
    render: ({onCancel, onComplete}) => React.createElement(ConnectorsFlow, {onCancel, onComplete}),
  }),
  description: 'Manage agent connectors (rules, hook, mcp, or skill)',
  name: 'connectors',
}
