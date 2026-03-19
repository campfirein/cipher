import React from 'react'

import type {SlashCommand} from '../../../types/commands.js'

import {ConnectorsSyncFlow} from '../../connectors/components/connectors-sync-flow.js'

export const connectorsSyncCommand: SlashCommand = {
  action: () => ({
    render: ({onCancel, onComplete}) => React.createElement(ConnectorsSyncFlow, {onCancel, onComplete}),
  }),
  description: 'Sync project knowledge into installed agent SKILL.md files',
  name: 'sync',
}
