import React from 'react'

import type {SlashCommand} from '../../../types/commands.js'

import {StatusView} from '../../status/components/status-view.js'

export const statusCommand: SlashCommand = {
  action(context) {
    return {
      render: ({onCancel, onComplete}) =>
        React.createElement(StatusView, {onCancel, onComplete, version: context.version}),
    }
  },
  description: 'Show CLI status and project information',
  name: 'status',
}
