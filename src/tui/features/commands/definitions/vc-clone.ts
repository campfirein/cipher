import React from 'react'

import type {SlashCommand} from '../../../types/commands.js'

import {VcCloneFlow} from '../../vc/clone/components/vc-clone-flow.js'

export const vcCloneSubCommand: SlashCommand = {
  async action() {
    return {
      render: ({onCancel, onComplete}) => React.createElement(VcCloneFlow, {onCancel, onComplete}),
    }
  },
  description: 'Clone a ByteRover space repository',
  name: 'clone',
}
