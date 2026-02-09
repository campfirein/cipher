import React from 'react'

import type {SlashCommand} from '../../../types/commands.js'

import {SpaceSwitchFlow} from '../../space/components/space-switch-flow.js'

export const spaceSwitchCommand: SlashCommand = {
  action: () => ({
    render: ({onCancel, onComplete}) => React.createElement(SpaceSwitchFlow, {onCancel, onComplete}),
  }),
  description: 'Switch to a different space',
  name: 'switch',
}
