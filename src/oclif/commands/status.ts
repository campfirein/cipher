import {Command, Flags} from '@oclif/core'
import chalk from 'chalk'

import type {GitChanges, StatusDTO} from '../../shared/transport/types/dto.js'

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
    const format = flags.format as 'json' | 'text'

    try {
      const status = await this.fetchStatus()

      if (format === 'json') {
        writeJsonResponse({
          command: 'status',
          data: {...status, cliVersion: this.config.version},
          success: true,
        })
      } else {
        this.formatTextOutput(status)
      }
    } catch (error) {
      if (format === 'json') {
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

    // Branch
    if (status.gitBranch) {
      this.log(`On branch: ${status.gitBranch}`)
    }

    // Context tree status
    switch (status.contextTreeStatus) {
      case 'has_changes': {
        if (status.gitChanges && status.contextTreeRelativeDir) {
          this.logGitChanges(status.gitChanges, status.contextTreeRelativeDir)
        }

        break
      }

      case 'no_changes': {
        this.log('Context Tree: No changes')
        break
      }

      case 'not_initialized': {
        this.log('Context Tree: Not initialized — run `brv foo init` to initialize')
        break
      }

      default: {
        this.log('Context Tree: Unable to check status')
      }
    }
  }

  private logGitChanges(changes: GitChanges, relativeDir: string): void {
    const fp = (file: string) => `${relativeDir}/${file}`
    const {staged, unstaged, untracked} = changes

    if (staged.added.length > 0 || staged.modified.length > 0 || staged.deleted.length > 0) {
      this.log('Changes to be committed:')
      for (const f of staged.added) this.log(chalk.green(`\tnew file:   ${fp(f)}`))
      for (const f of staged.modified) this.log(chalk.green(`\tmodified:   ${fp(f)}`))
      for (const f of staged.deleted) this.log(chalk.green(`\tdeleted:    ${fp(f)}`))
    }

    if (unstaged.modified.length > 0 || unstaged.deleted.length > 0) {
      this.log('Changes not staged for commit:')
      for (const f of unstaged.modified) this.log(chalk.red(`\tmodified:   ${fp(f)}`))
      for (const f of unstaged.deleted) this.log(chalk.red(`\tdeleted:    ${fp(f)}`))
    }

    if (untracked.length > 0) {
      this.log('Untracked files:')
      for (const f of untracked) this.log(chalk.red(`\t${fp(f)}`))
    }
  }
}
