import {Args, Command, Flags} from '@oclif/core'

import {type ReviewDecideTaskResponse, ReviewEvents} from '../../../shared/transport/events/review-events.js'
import {type DaemonClientOptions, formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'

export default class ReviewApprove extends Command {
  public static args = {
    taskId: Args.string({
      description: 'Task ID shown in the curate output (e.g. "brv review approve abc-123")',
      required: true,
    }),
  }
  public static description = 'Approve all pending review operations for a curate task'
  public static examples = [
    '# Approve all pending changes from a curate task',
    '<%= config.bin %> review approve abc-123',
    '',
    '# Approve and get structured output (useful for coding agents)',
    '<%= config.bin %> review approve abc-123 --format json',
  ]
  public static flags = {
    format: Flags.string({
      default: 'text',
      description: 'Output format (text or json)',
      options: ['text', 'json'],
    }),
  }

  protected getDaemonClientOptions(): DaemonClientOptions {
    return {}
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(ReviewApprove)
    const format = (flags.format ?? 'text') as 'json' | 'text'

    try {
      const response = await withDaemonRetry(
        (client) =>
          client.requestWithAck<ReviewDecideTaskResponse>(ReviewEvents.DECIDE_TASK, {
            decision: 'approved',
            taskId: args.taskId,
          }),
        this.getDaemonClientOptions(),
      )

      if (format === 'json') {
        writeJsonResponse({
          command: 'review',
          data: {
            decision: 'approved',
            files: response.files,
            status: 'success',
            taskId: args.taskId,
            totalCount: response.totalCount,
          },
          success: true,
        })
      } else {
        if (response.totalCount === 0) {
          this.log(`No pending operations found for task ${args.taskId}.`)
          return
        }

        for (const file of response.files) {
          this.log(`✓ Approved ${file.path}`)
        }

        this.log(`\n${response.totalCount} operation${response.totalCount === 1 ? '' : 's'} approved.`)
      }
    } catch (error) {
      if (format === 'json') {
        writeJsonResponse({
          command: 'review',
          data: {error: error instanceof Error ? error.message : 'Review failed', status: 'error'},
          success: false,
        })
      } else {
        this.log(formatConnectionError(error))
      }
    }
  }
}
