import {Args, Command} from '@oclif/core'

import {
  WorkspaceEvents,
  type WorkspaceOperationResponse,
  type WorkspaceRemoveRequest,
} from '../../../shared/transport/events/workspace-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class WorkspaceRemove extends Command {
  public static args = {
    path: Args.string({
      description: 'Path of the workspace to remove (relative or absolute)',
      required: true,
    }),
  }
  public static description = 'Remove a project from knowledge workspaces'
  public static examples = [
    '<%= config.bin %> workspace remove ../shared-lib',
    '<%= config.bin %> workspace remove /absolute/path/to/project',
  ]

  public async run(): Promise<void> {
    const {args} = await this.parse(WorkspaceRemove)

    try {
      const result = await withDaemonRetry<WorkspaceOperationResponse>(
        async (client) =>
          client.requestWithAck<WorkspaceOperationResponse, WorkspaceRemoveRequest>(
            WorkspaceEvents.REMOVE,
            {path: args.path},
          ),
      )

      this.log(result.message)
    } catch (error) {
      this.log(formatConnectionError(error))
    }
  }
}
