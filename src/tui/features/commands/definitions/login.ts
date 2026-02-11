import React from 'react'

import type {SlashCommand} from '../../../types/commands.js'

import {LoginFlow} from '../../auth/components/login-flow.js'

export const loginCommand: SlashCommand = {
  action: () => ({
    render: ({onCancel, onComplete}) =>
      React.createElement(LoginFlow, {
        onCancel,
        onComplete: (message: string) =>
          onComplete(message, {reloadAuth: true, restartAgent: {reason: 'User logged in'}}),
      }),
  }),
  description: 'Authenticate with ByteRover using OAuth 2.0 + PKCE',
  name: 'login',
}
