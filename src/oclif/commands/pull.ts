import {Command, Flags} from '@oclif/core'

import {
  PullEvents,
  type PullExecuteResponse,
  type PullPrepareResponse,
} from '../../shared/transport/events/pull-events.js'
import {formatConnectionError, withDaemonRetry} from '../lib/daemon-client.js'
import {writeJsonResponse} from '../lib/json-response.js'

type PullResult = {hasChanges: false; result: PullExecuteResponse} | {hasChanges: true; summary: string}

export default class Pull extends Command {
  public static description = `Pull context tree from ByteRover memory storage

Downloads the context tree from the ByteRover cloud to your local project.`
  public static examples = [
    '# Pull from default branch (main)',
    '<%= config.bin %> <%= command.id %>',
    '',
    '# Pull from specific branch',
    '<%= config.bin %> <%= command.id %> --branch feature-branch',
    '',
  ]
  public static flags = {
    branch: Flags.string({
      char: 'b',
      default: 'main',
      description: 'ByteRover branch name (not Git branch)',
    }),
    format: Flags.string({
      default: 'text',
      description: 'Output format (text or json)',
      options: ['text', 'json'],
    }),
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Pull)
    const format = (flags.format ?? 'text') as 'json' | 'text'
    const branch = flags.branch ?? 'main'

    try {
      const pullResult = await this.executePull(branch)

      if (pullResult.hasChanges) {
        if (format === 'json') {
          writeJsonResponse({command: 'pull', data: {error: pullResult.summary}, success: false})
        } else {
          this.log(pullResult.summary)
          this.logVcHint()
        }

        return
      }

      const {result} = pullResult

      if (format === 'json') {
        writeJsonResponse({command: 'pull', data: result, success: true})
      } else {
        this.log('\n✓ Successfully pulled context tree from ByteRover memory storage!')
        this.log(`  Branch: ${branch}`)
        this.log(`  Commit: ${result.commitSha.slice(0, 7)}`)
        this.log(`  Added: ${result.added}, Edited: ${result.edited}, Deleted: ${result.deleted}`)
        this.logVcHint()
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Pull failed'

      if (format === 'json') {
        writeJsonResponse({command: 'pull', data: {error: errorMessage}, success: false})
      } else {
        this.log(formatConnectionError(error))
        this.logVcHint()
      }
    }
  }

  private async executePull(branch: string): Promise<PullResult> {
    return withDaemonRetry(async (client) => {
      const prepareResponse = await client.requestWithAck<PullPrepareResponse>(PullEvents.PREPARE, {branch})

      if (prepareResponse.hasChanges) {
        return {hasChanges: true, summary: prepareResponse.summary}
      }

      const result = await client.requestWithAck<PullExecuteResponse>(PullEvents.EXECUTE, {branch})
      return {hasChanges: false, result}
    })
  }

  private logVcHint(): void {
    this.log('\nTip: Version control is now available for your context tree.')
    this.log('Learn more: https://docs.byterover.dev/git-semantic/overview')
  }
}
