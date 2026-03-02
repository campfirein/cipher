import React from 'react'

import type {SlashCommand} from '../../../types/commands.js'

import {HubFlow} from '../../hub/components/hub-flow.js'

export const hubListCommand: SlashCommand = {
  action: () => ({
    render: ({onCancel, onComplete}) => React.createElement(HubFlow, {onCancel, onComplete}),
  }),
  description: 'Browse and install skills & bundles from the hub',
  name: 'list',
}
