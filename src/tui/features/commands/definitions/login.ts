import React from 'react'

import type {SlashCommand} from '../../../types/commands.js'

import {LoginFlow} from '../../auth/components/login-flow.js'

export const loginCommand: SlashCommand = {
  action: () => ({
    render: ({onCancel, onComplete}) =>
      React.createElement(LoginFlow, {
        onCancel,
        onComplete: (message: string) => onComplete(message, {reloadAuth: true}),
      }),
  }),
  description: 'Connect to ByteRover cloud for push/pull sync (optional for local usage)',
  name: 'login',
}
