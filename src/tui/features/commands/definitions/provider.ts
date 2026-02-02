import React from 'react'

import type {SlashCommand} from '../../../types/commands.js'

import {ProviderFlow} from '../../provider/components/provider-flow.js'

export const providerCommand: SlashCommand = {
  action: () => ({
    render: ({onCancel, onComplete}) => React.createElement(ProviderFlow, {onCancel, onComplete}),
  }),
  description: 'Connect to an LLM provider (e.g., OpenRouter)',
  name: 'provider',
}
