import {Args, Command, Flags} from '@oclif/core'

import {type ReviewDecideTaskResponse, ReviewEvents} from '../../../shared/transport/events/review-events.js'
import {type DaemonClientOptions, formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'

type ReviewFile = ReviewDecideTaskResponse['files'][number]

export abstract class ReviewDecisionCommand extends Command {
  public static args = {
    taskId: Args.string({
      required: true,
    }),
  }
public static flags = {
    file: Flags.string({
      multiple: true,
    }),
    format: Flags.string({
      default: 'text',
      description: 'Output format (text or json)',
      options: ['text', 'json'],
    }),
  }

  protected abstract readonly decision: 'approved' | 'rejected'

  protected abstract formatFileLine(file: ReviewFile): string

  protected getDaemonClientOptions(): DaemonClientOptions {
    return {}
  }

  public async run(): Promise<void> {
    const ctor = this.constructor as typeof ReviewDecisionCommand
    const {args, flags} = await this.parse({args: ctor.args, flags: ctor.flags})
    const format = flags.format === 'json' ? 'json' : 'text'

    try {
      const response = await withDaemonRetry(
        (client) =>
          client.requestWithAck<ReviewDecideTaskResponse>(ReviewEvents.DECIDE_TASK, {
            decision: this.decision,
            ...(flags.file?.length ? {filePaths: flags.file} : {}),
            taskId: args.taskId,
          }),
        this.getDaemonClientOptions(),
      )

      if (format === 'json') {
        writeJsonResponse({
          command: 'review',
          data: {
            decision: this.decision,
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
          this.log(this.formatFileLine(file))
        }

        this.log(`\n${response.totalCount} operation${response.totalCount === 1 ? '' : 's'} ${this.decision}.`)
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
