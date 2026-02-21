import React from 'react'

import type {SlashCommand} from '../../../types/commands.js'

import {HubRegistryListView} from '../../hub/components/hub-registry-list-view.js'

export const hubRegistryListCommand: SlashCommand = {
  action: () => ({
    render: ({onCancel, onComplete}) => React.createElement(HubRegistryListView, {onCancel, onComplete}),
  }),
  description: 'List configured hub registries',
  name: 'list',
}
