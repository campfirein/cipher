import React from 'react'

import type {SlashCommand} from '../../../types/commands.js'

import {VcConflictsFlow} from '../../vc/conflicts/components/vc-conflicts-flow.js'

export const vcConflictsSubCommand: SlashCommand = {
  action() {
    return {
      render: ({onCancel, onComplete}) => React.createElement(VcConflictsFlow, {onCancel, onComplete}),
    }
  },
  description: 'List files with conflict markers',
  name: 'conflicts',
}
