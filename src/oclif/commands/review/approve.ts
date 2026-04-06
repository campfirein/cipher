import {Args, Flags} from '@oclif/core'

import type {ReviewDecideTaskResponse} from '../../../shared/transport/events/review-events.js'

import {ReviewDecisionCommand} from './base-review-decision.js'

type ReviewFile = ReviewDecideTaskResponse['files'][number]

export default class ReviewApprove extends ReviewDecisionCommand {
  public static args = {
    taskId: Args.string({
      description: 'Task ID shown in the curate output (e.g. "brv review approve abc-123")',
      required: true,
    }),
  }
public static description = 'Approve pending review operations for a curate task'
public static examples = [
    '# Approve all pending changes from a curate task',
    '<%= config.bin %> review approve abc-123',
    '',
    '# Approve specific files',
    '<%= config.bin %> review approve abc-123 --file architecture/security/audit.md',
    '<%= config.bin %> review approve abc-123 --file auth/jwt.md --file auth/oauth.md',
    '',
    '# Approve and get structured output (useful for coding agents)',
    '<%= config.bin %> review approve abc-123 --format json',
  ]
public static flags = {
    file: Flags.string({
      description: 'Approve only the specified file path(s) (relative to context tree)',
      multiple: true,
    }),
    format: Flags.string({
      default: 'text',
      description: 'Output format (text or json)',
      options: ['text', 'json'],
    }),
  }
protected readonly decision = 'approved' as const

  protected formatFileLine(file: ReviewFile): string {
    return `✓ Approved ${file.path}`
  }
}
