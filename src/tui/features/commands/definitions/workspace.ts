import type {SlashCommand} from '../../../types/commands.js'

import {
  type WorkspaceAddRequest,
  WorkspaceEvents,
  type WorkspaceOperationResponse,
  type WorkspaceRemoveRequest,
} from '../../../../shared/transport/events/workspace-events.js'
import {useTransportStore} from '../../../stores/transport-store.js'

const workspaceAddCommand: SlashCommand = {
  async action(_context, args) {
    const targetPath = args.trim()
    if (!targetPath) {
      return {
        content: 'Usage: /workspace add <path-to-project>',
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
      const result = await apiClient.request<WorkspaceOperationResponse, WorkspaceAddRequest>(
        WorkspaceEvents.ADD,
        {targetPath},
      )

      return {
        content: result.message,
        messageType: result.success ? ('info' as const) : ('error' as const),
        type: 'message' as const,
      }
    } catch (error) {
      return {
        content: `Failed to add workspace: ${error instanceof Error ? error.message : 'Unknown error'}`,
        messageType: 'error' as const,
        type: 'message' as const,
      }
    }
  },
  args: [{description: 'Path to the project to add', name: 'path', required: true}],
  description: 'Add a project as a knowledge workspace',
  name: 'add',
}

const workspaceRemoveCommand: SlashCommand = {
  async action(_context, args) {
    const path = args.trim()
    if (!path) {
      return {
        content: 'Usage: /workspace remove <path>',
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
      const result = await apiClient.request<WorkspaceOperationResponse, WorkspaceRemoveRequest>(
        WorkspaceEvents.REMOVE,
        {path},
      )

      return {
        content: result.message,
        messageType: result.success ? ('info' as const) : ('error' as const),
        type: 'message' as const,
      }
    } catch (error) {
      return {
        content: `Failed to remove workspace: ${error instanceof Error ? error.message : 'Unknown error'}`,
        messageType: 'error' as const,
        type: 'message' as const,
      }
    }
  },
  args: [{description: 'Path of the workspace to remove', name: 'path', required: true}],
  description: 'Remove a project from knowledge workspaces',
  name: 'remove',
}

export const workspaceCommand: SlashCommand = {
  description: 'Manage knowledge workspaces (add/remove linked projects)',
  name: 'workspace',
  subCommands: [workspaceAddCommand, workspaceRemoveCommand],
}
