import {Args, Flags} from '@oclif/core'

import type {ReviewDecideTaskResponse} from '../../../shared/transport/events/review-events.js'

import {ReviewDecisionCommand} from './base-review-decision.js'

type ReviewFile = ReviewDecideTaskResponse['files'][number]

export default class ReviewReject extends ReviewDecisionCommand {
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
    '# Reject specific files',
    '<%= config.bin %> review reject abc-123 --file architecture/security/audit.md',
    '<%= config.bin %> review reject abc-123 --file auth/jwt.md --file auth/oauth.md',
    '',
    '# Reject and get structured output (useful for coding agents)',
    '<%= config.bin %> review reject abc-123 --format json',
  ]
public static flags = {
    file: Flags.string({
      description: 'Reject only the specified file path(s) (relative to context tree)',
      multiple: true,
    }),
    format: Flags.string({
      default: 'text',
      description: 'Output format (text or json)',
      options: ['text', 'json'],
    }),
  }
protected readonly decision = 'rejected' as const

  protected formatFileLine(file: ReviewFile): string {
    const suffix = file.reverted ? ' (restored from backup)' : ''
    return `✓ Rejected ${file.path}${suffix}`
  }
}
