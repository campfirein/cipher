import {Command, Flags} from '@oclif/core'
import chalk from 'chalk'

import type {StatusDTO} from '../../shared/transport/types/dto.js'

import {StatusEvents, type StatusGetResponse} from '../../shared/transport/events/status-events.js'
import {type DaemonClientOptions, formatConnectionError, withDaemonRetry} from '../lib/daemon-client.js'
import {writeJsonResponse} from '../lib/json-response.js'

export default class Status extends Command {
  public static description =
    'Show CLI status and project information. Display local context tree managed by ByteRover CLI'
  public static examples = ['<%= config.bin %> <%= command.id %>', '<%= config.bin %> <%= command.id %> --format json']
  public static flags = {
    format: Flags.string({
      char: 'f',
      default: 'text',
      description: 'Output format',
      options: ['text', 'json'],
    }),
  }

  protected async fetchStatus(options?: DaemonClientOptions): Promise<StatusDTO> {
    return withDaemonRetry<StatusDTO>(async (client) => {
      const response = await client.requestWithAck<StatusGetResponse>(StatusEvents.GET)
      return response.status
    }, options)
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Status)
    const isJson = flags.format === 'json'

    try {
      const status = await this.fetchStatus()

      if (isJson) {
        writeJsonResponse({
          command: 'status',
          data: {...status, cliVersion: this.config.version},
          success: true,
        })
      } else {
        this.formatTextOutput(status)
      }
    } catch (error) {
      if (isJson) {
        writeJsonResponse({
          command: 'status',
          data: {error: formatConnectionError(error)},
          success: false,
        })
      } else {
        this.log(formatConnectionError(error))
      }
    }
  }

  private formatTextOutput(status: StatusDTO): void {
    this.log(`CLI Version: ${this.config.version}`)

    // Auth status (cloud sync only — not required for local usage)
    switch (status.authStatus) {
      case 'expired': {
        this.log('Account: Session expired')
        break
      }

      case 'logged_in': {
        this.log(`Account: ${status.userEmail}`)
        break
      }

      case 'not_logged_in': {
        this.log('Account: Not connected (optional — login for push/pull sync)')
        break
      }

      default: {
        this.log('Account: Unable to check')
      }
    }

    this.log(`Current Directory: ${status.currentDirectory}`)

    // Space
    if (status.teamName && status.spaceName) {
      this.log(`Space: ${status.teamName}/${status.spaceName}`)
    } else {
      this.log('Space: Not connected')
    }

    // Context tree status
    switch (status.contextTreeStatus) {
      case 'has_changes': {
        if (status.contextTreeChanges && status.contextTreeRelativeDir) {
          const formatPath = (file: string) => `${status.contextTreeRelativeDir}/${file}`

          const allChanges = [
            ...status.contextTreeChanges.modified.map((f) => ({path: f, status: 'modified:'})),
            ...status.contextTreeChanges.added.map((f) => ({path: f, status: 'new file:'})),
            ...status.contextTreeChanges.deleted.map((f) => ({path: f, status: 'deleted:'})),
          ].sort((a, b) => a.path.localeCompare(b.path))

          this.log('Context Tree Changes:')
          for (const change of allChanges) {
            this.log(`   ${chalk.red(`${change.status.padEnd(10)} ${formatPath(change.path)}`)}`)
          }
        }

        break
      }

      case 'no_changes': {
        this.log('Context Tree: No changes')
        break
      }

      case 'not_initialized': {
        this.log('Context Tree: Not initialized')
        break
      }

      default: {
        this.log('Context Tree: Unable to check status')
      }
    }
  }
}
