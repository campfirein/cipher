import {Args, Command, Flags} from '@oclif/core'

import {SKILL_CONNECTOR_CONFIGS} from '../../../server/infra/connectors/skill/skill-connector-config.js'
import {
  HubEvents,
  type HubInstallAllResponse,
  type HubInstallRequest,
  type HubInstallResponse,
} from '../../../shared/transport/events/hub-events.js'
import {type DaemonClientOptions, formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'

export default class HubInstall extends Command {
  public static args = {
    id: Args.string({
      description: 'Entry ID to install (omit to install all from dependencies.json)',
      required: false,
    }),
  }
  public static description = 'Install a skill or bundle from the hub'
  public static examples = [
    '<%= config.bin %> hub install byterover-review --agent "Claude Code"',
    '<%= config.bin %> hub install typescript-kickstart',
    '<%= config.bin %> hub install                         # install all from dependencies.json',
  ]
  public static flags = {
    agent: Flags.string({
      char: 'a',
      description: 'Target agent for skill install',
      options: Object.keys(SKILL_CONNECTOR_CONFIGS),
    }),
    format: Flags.string({
      char: 'f',
      default: 'text',
      description: 'Output format',
      options: ['text', 'json'],
    }),
    registry: Flags.string({
      char: 'r',
      description: 'Registry to install from (when ID exists in multiple registries)',
    }),
    scope: Flags.string({
      char: 's',
      default: 'project',
      description: 'Install scope for skills (global: home directory, project: current project)',
      options: ['global', 'project'],
    }),
  }

  protected async executeInstall(
    params: {agent?: string; entryId: string; registry?: string; scope?: 'global' | 'project'},
    options?: DaemonClientOptions,
  ): Promise<HubInstallResponse> {
    return withDaemonRetry<HubInstallResponse>(
      async (client) => client.requestWithAck<HubInstallResponse, HubInstallRequest>(HubEvents.INSTALL, params),
      options,
    )
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(HubInstall)
    const format = flags.format as 'json' | 'text'

    await (args.id ? this.installSingle(args.id, flags, format) : this.installAll(format))
  }

  private async installAll(format: 'json' | 'text'): Promise<void> {
    try {
      const result = await withDaemonRetry<HubInstallAllResponse>(async (client) =>
        client.requestWithAck<HubInstallAllResponse>(HubEvents.INSTALL_ALL),
      )

      if (format === 'json') {
        writeJsonResponse({command: 'hub install', data: result, success: result.success})
      } else {
        if (result.results.length > 0) {
          for (const r of result.results) {
            this.log(`  ${r.success ? '✓' : '✗'} ${r.entryId}: ${r.message}`)
          }
        }

        this.log(result.message)
      }
    } catch (error) {
      if (format === 'json') {
        writeJsonResponse({command: 'hub install', data: {error: formatConnectionError(error)}, success: false})
      } else {
        this.log(formatConnectionError(error))
      }
    }
  }

  private async installSingle(
    entryId: string,
    flags: {agent?: string; format: string; registry?: string; scope?: string},
    format: 'json' | 'text',
  ): Promise<void> {
    try {
      const result = await this.executeInstall({
        agent: flags.agent,
        entryId,
        registry: flags.registry,
        scope: flags.scope as 'global' | 'project',
      })

      if (format === 'json') {
        writeJsonResponse({command: 'hub install', data: result, success: result.success})
      } else {
        this.log(result.message)
        if (result.installedPath) {
          this.log(`Location: ${result.installedPath}`)
        }
      }
    } catch (error) {
      if (format === 'json') {
        writeJsonResponse({command: 'hub install', data: {error: formatConnectionError(error)}, success: false})
      } else {
        this.log(formatConnectionError(error))
      }
    }
  }
}
