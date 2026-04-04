import type {SlashCommand} from '../../../types/commands.js'

import {
  HubEvents,
  type HubUninstallRequest,
  type HubUninstallResponse,
} from '../../../../shared/transport/events/hub-events.js'
import {useTransportStore} from '../../../stores/transport-store.js'

export const hubUninstallCommand: SlashCommand = {
  async action(_context, args) {
    const entryId = args.trim()
    if (!entryId) {
      return {
        content: 'Usage: /hub uninstall <entry-id>',
        messageType: 'error' as const,
        type: 'message' as const,
      }
    }

    const {apiClient} = useTransportStore.getState()
    if (!apiClient) {
      return {
        content: 'Not connected to daemon.',
        messageType: 'error' as const,
        type: 'message' as const,
      }
    }

    try {
      const result = await apiClient.request<HubUninstallResponse, HubUninstallRequest>(
        HubEvents.UNINSTALL,
        {entryId},
      )

      return {
        content: result.message,
        messageType: result.success ? ('info' as const) : ('error' as const),
        type: 'message' as const,
      }
    } catch (error) {
      return {
        content: `Failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        messageType: 'error' as const,
        type: 'message' as const,
      }
    }
  },
  args: [{description: 'Entry ID to uninstall', name: 'id', required: true}],
  description: 'Uninstall a bundle and remove from dependencies',
  name: 'uninstall',
}
