import React from 'react'

import type {SlashCommand} from '../../../types/commands.js'

import {LocationsView} from '../../locations/components/locations-view.js'

export const locationsCommand: SlashCommand = {
  action() {
    return {
      render: ({onCancel, onComplete}) => React.createElement(LocationsView, {onCancel, onComplete}),
    }
  },
  description: 'List all registered projects and their context tree status',
  name: 'locations',
}
