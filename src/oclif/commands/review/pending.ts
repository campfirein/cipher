import {Command, Flags} from '@oclif/core'

import {
  ReviewEvents,
  type ReviewPendingResponse,
  type ReviewPendingTask,
} from '../../../shared/transport/events/review-events.js'
import {type DaemonClientOptions, formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'

export default class ReviewPending extends Command {
  public static description = 'List all pending review operations for the current project'
  public static examples = [
    '# Show all pending reviews',
    '<%= config.bin %> review pending',
    '',
    '# Get structured output for agent-driven workflows',
    '<%= config.bin %> review pending --format json',
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
    const {flags} = await this.parse(ReviewPending)
    const format = flags.format === 'json' ? 'json' : 'text'

    try {
      const response = await withDaemonRetry(
        (client) => client.requestWithAck<ReviewPendingResponse>(ReviewEvents.PENDING, {}),
        this.getDaemonClientOptions(),
      )

      if (format === 'json') {
        writeJsonResponse({
          command: 'review',
          data: {
            pendingCount: response.pendingCount,
            status: 'success',
            tasks: response.tasks,
          },
          success: true,
        })
      } else {
        this.printText(response)
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

  private printTask(task: ReviewPendingTask): void {
    this.log(`  Task: ${task.taskId}`)
    for (const [i, op] of task.operations.entries()) {
      const impact = op.impact === 'high' ? ' · HIGH IMPACT' : ''
      const displayPath = op.filePath ?? op.path
      if (i > 0) this.log('')
      this.log(`  [${op.type}${impact}] - path: ${displayPath}`)
      if (op.reason) this.log(`  Why:    ${op.reason}`)
      if (op.previousSummary) this.log(`  Before: ${op.previousSummary}`)
      if (op.summary) this.log(`  After:  ${op.summary}`)
    }

    this.log('')
    this.log(`  To approve all:  ${this.config.bin} review approve ${task.taskId}`)
    this.log(`  To reject all:   ${this.config.bin} review reject ${task.taskId}`)
    this.log(`  Per file:        ${this.config.bin} review approve/reject ${task.taskId} --file <path> [--file <path>]`)
  }

  private printText(response: ReviewPendingResponse): void {
    if (response.pendingCount === 0) {
      this.log('No pending reviews.')
      return
    }

    const {pendingCount} = response
    this.log(`${pendingCount} operation${pendingCount === 1 ? '' : 's'} pending review`)
    this.log('')

    for (const [i, task] of response.tasks.entries()) {
      if (i > 0) {
        this.log('')
        this.log('---')
        this.log('')
      }

      this.printTask(task)
    }
  }
}
