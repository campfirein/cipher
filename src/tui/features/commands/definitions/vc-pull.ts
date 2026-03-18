import React from 'react'

import type {SlashCommand} from '../../../types/commands.js'

import {VcPullFlow} from '../../vc/pull/components/vc-pull-flow.js'

export const vcPullSubCommand: SlashCommand = {
  action() {
    return {
      render: ({onCancel, onComplete}) => React.createElement(VcPullFlow, {onCancel, onComplete}),
    }
  },
  description: 'Pull commits from ByteRover cloud',
  name: 'pull',
}
