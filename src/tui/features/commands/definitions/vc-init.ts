import React from 'react'

import type {SlashCommand} from '../../../types/commands.js'

import {VcInitFlow} from '../../vc/init/components/vc-init-flow.js'

export const vcInitSubCommand: SlashCommand = {
  action() {
    return {
      render: ({onCancel, onComplete}) => React.createElement(VcInitFlow, {onCancel, onComplete}),
    }
  },
  description: 'Initialize git repository in .brv/context-tree/',
  name: 'init',
}
