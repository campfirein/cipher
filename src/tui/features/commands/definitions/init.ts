import React from 'react'

import type {SlashCommand} from '../../../types/commands.js'

import {InitFlow} from '../../init/components/init-flow.js'

export const initCommand: SlashCommand = {
  action() {
    return {
      render: ({onCancel, onComplete}) => React.createElement(InitFlow, {onCancel, onComplete}),
    }
  },
  description: 'Initialize git repository in .brv/context-tree/',
  name: 'init',
}
