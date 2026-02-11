import React from 'react'

import type {SlashCommand} from '../../../types/commands.js'

import {ModelFlow} from '../../model/components/model-flow.js'

export const modelCommand: SlashCommand = {
  action: () => ({
    render: ({onCancel, onComplete}) => React.createElement(ModelFlow, {onCancel, onComplete}),
  }),
  description: 'Select a model from the active provider',
  name: 'model',
}
