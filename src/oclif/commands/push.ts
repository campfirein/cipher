import {Command, Flags} from '@oclif/core'

import {
  PushEvents,
  type PushExecuteResponse,
  type PushPrepareResponse,
} from '../../shared/transport/events/push-events.js'
import {formatConnectionError, withDaemonRetry} from '../lib/daemon-client.js'
import {writeJsonResponse} from '../lib/json-response.js'

type PushResult = {cancelled: true} | {noChanges: false; result: PushExecuteResponse} | {noChanges: true}

export default class Push extends Command {
  public static description = `Push context tree to ByteRover memory storage

Uploads your local context tree changes to the ByteRover cloud.`
  public static examples = [
    '# Push to default branch (main)',
    '<%= config.bin %> <%= command.id %>',
    '',
    '# Push to specific branch',
    '<%= config.bin %> <%= command.id %> --branch feature-branch',
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
    const {flags} = await this.parse(Push)
    const format = (flags.format ?? 'text') as 'json' | 'text'
    const branch = flags.branch ?? 'main'

    try {
      const pushResult = await this.executePush(branch)

      if ('cancelled' in pushResult) {
        if (format === 'json') {
          writeJsonResponse({command: 'push', data: {status: 'cancelled'}, success: false})
        } else {
          this.log('Push cancelled.')
        }

        return
      }

      if ('noChanges' in pushResult && pushResult.noChanges) {
        if (format === 'json') {
          writeJsonResponse({command: 'push', data: {status: 'no_changes'}, success: true})
        } else {
          this.log('No context changes to push.')
        }

        return
      }

      const {result} = pushResult

      if (format === 'json') {
        writeJsonResponse({
          command: 'push',
          data: {
            added: result.added,
            branch,
            deleted: result.deleted,
            edited: result.edited,
            status: 'success',
            url: result.url,
          },
          success: true,
        })
      } else {
        this.log('\n✓ Successfully pushed context tree to ByteRover memory storage!')
        this.log(`  Branch: ${branch}`)
        this.log(`  Added: ${result.added}, Edited: ${result.edited}, Deleted: ${result.deleted}`)
        this.log(`  View: ${result.url}`)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Push failed'

      if (format === 'json') {
        writeJsonResponse({command: 'push', data: {error: errorMessage, status: 'error'}, success: false})
      } else {
        this.log(formatConnectionError(error))
      }
    }
  }

  private async executePush(branch: string): Promise<PushResult> {
    return withDaemonRetry(async (client) => {
      const prepareResponse = await client.requestWithAck<PushPrepareResponse>(PushEvents.PREPARE, {branch})

      if (!prepareResponse.hasChanges) {
        return {noChanges: true}
      }

      const result = await client.requestWithAck<PushExecuteResponse>(PushEvents.EXECUTE, {branch})
      return {noChanges: false, result}
    })
  }
}
