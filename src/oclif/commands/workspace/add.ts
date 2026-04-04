import {Args, Command} from '@oclif/core'

import {
  type WorkspaceAddRequest,
  WorkspaceEvents,
  type WorkspaceOperationResponse,
} from '../../../shared/transport/events/workspace-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class WorkspaceAdd extends Command {
  public static args = {
    path: Args.string({
      description: 'Path to the project to add as a workspace',
      required: true,
    }),
  }
  public static description = 'Add a project as a knowledge workspace'
  public static examples = [
    '<%= config.bin %> workspace add ../shared-lib',
    '<%= config.bin %> workspace add /absolute/path/to/project',
  ]

  public async run(): Promise<void> {
    const {args} = await this.parse(WorkspaceAdd)

    try {
      const result = await withDaemonRetry<WorkspaceOperationResponse>(async (client) =>
        client.requestWithAck<WorkspaceOperationResponse, WorkspaceAddRequest>(WorkspaceEvents.ADD, {
          targetPath: args.path,
        }),
      )

      this.log(result.message)
    } catch (error) {
      this.log(formatConnectionError(error))
    }
  }
}
