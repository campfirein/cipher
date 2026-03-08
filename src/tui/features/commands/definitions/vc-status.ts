import React from 'react'

import type {SlashCommand} from '../../../types/commands.js'

import {VcStatusFlow} from '../../vc/status/components/vc-status-flow.js'

export const vcStatusSubCommand: SlashCommand = {
  action() {
    return {
      render: ({onCancel, onComplete}) => React.createElement(VcStatusFlow, {onCancel, onComplete}),
    }
  },
  description: 'Show git status of the context tree',
  name: 'status',
}
