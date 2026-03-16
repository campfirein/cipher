import {Args, Command, Flags} from '@oclif/core'

import {type ReviewDecideTaskResponse, ReviewEvents} from '../../../shared/transport/events/review-events.js'
import {type DaemonClientOptions, formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'

export default class ReviewReject extends Command {
  public static args = {
    taskId: Args.string({
      description: 'Task ID shown in the curate output (e.g. "brv review reject abc-123")',
      required: true,
    }),
  }
  public static description = 'Reject pending review operations for a curate task (restores files from backup)'
  public static examples = [
    '# Reject all pending changes from a curate task',
    '<%= config.bin %> review reject abc-123',
    '',
    '# Reject a single file',
    '<%= config.bin %> review reject abc-123 --file architecture/security/audit.md',
    '',
    '# Reject and get structured output (useful for coding agents)',
    '<%= config.bin %> review reject abc-123 --format json',
  ]
  public static flags = {
    file: Flags.string({
      description: 'Reject only the specified file path (relative to context tree)',
    }),
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
    const {args, flags} = await this.parse(ReviewReject)
    const format = (flags.format ?? 'text') as 'json' | 'text'

    try {
      const response = await withDaemonRetry(
        (client) =>
          client.requestWithAck<ReviewDecideTaskResponse>(ReviewEvents.DECIDE_TASK, {
            decision: 'rejected',
            ...(flags.file ? {filePath: flags.file} : {}),
            taskId: args.taskId,
          }),
        this.getDaemonClientOptions(),
      )

      if (format === 'json') {
        writeJsonResponse({
          command: 'review',
          data: {
            decision: 'rejected',
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
          const suffix = file.reverted ? ' (restored from backup)' : ''
          this.log(`✓ Rejected ${file.path}${suffix}`)
        }

        this.log(`\n${response.totalCount} operation${response.totalCount === 1 ? '' : 's'} rejected.`)
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
