import {Args, Command, Flags} from '@oclif/core'

import type {HubEntryDTO} from '../../shared/transport/types/dto.js'

import {SKILL_CONNECTOR_CONFIGS} from '../../server/infra/connectors/skill/skill-connector-config.js'
import {
  HubEvents,
  type HubInstallRequest,
  type HubInstallResponse,
  type HubListResponse,
} from '../../shared/transport/events/hub-events.js'
import {formatConnectionError, withDaemonRetry} from '../lib/daemon-client.js'
import {writeJsonResponse} from '../lib/json-response.js'

export default class Hub extends Command {
  public static args = {
    action: Args.string({
      description: 'Action to perform',
      options: ['install', 'list'],
      required: false,
    }),
    id: Args.string({
      description: 'Entry ID (for install)',
      required: false,
    }),
  }
  public static description = 'Browse and install skills & bundles from the community hub'
  public static examples = [
    '<%= config.bin %> hub',
    '<%= config.bin %> hub list',
    '<%= config.bin %> hub list --format json',
    '<%= config.bin %> hub install byterover-review --agent "Claude Code"',
    '<%= config.bin %> hub install typescript-kickstart',
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
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(Hub)
    const format = flags.format as 'json' | 'text'
    const action = args.action ?? 'list'

    try {
      await (action === 'install' ? this.handleInstall(args.id, flags.agent, format) : this.handleList(format))
    } catch (error) {
      if (format === 'json') {
        writeJsonResponse({command: 'hub', data: {error: formatConnectionError(error)}, success: false})
      } else {
        this.log(formatConnectionError(error))
      }
    }
  }

  private formatEntry(entry: HubEntryDTO): string {
    const type = entry.type === 'agent-skill' ? 'skill' : 'bundle'
    return `| ${entry.id} | ${type} | v${entry.version} | ${entry.description} | ${entry.category} |`
  }

  private async handleInstall(
    id: string | undefined,
    agent: string | undefined,
    format: 'json' | 'text',
  ): Promise<void> {
    if (!id) {
      if (format === 'json') {
        writeJsonResponse({command: 'hub', data: {error: 'Entry ID is required for install'}, success: false})
      } else {
        this.log('Usage: brv hub install <id> [--agent "Agent Name"]')
        this.log('Run "brv hub" to see available entries.')
      }

      return
    }

    const result = await withDaemonRetry<HubInstallResponse>(async (client) =>
      client.requestWithAck<HubInstallResponse, HubInstallRequest>(HubEvents.INSTALL, {agent, entryId: id}),
    )

    if (format === 'json') {
      writeJsonResponse({command: 'hub', data: result, success: result.success})
    } else {
      this.log(result.message)
    }
  }

  private async handleList(format: 'json' | 'text'): Promise<void> {
    const data = await withDaemonRetry<HubListResponse>(async (client) =>
      client.requestWithAck<HubListResponse>(HubEvents.LIST),
    )

    if (format === 'json') {
      writeJsonResponse({command: 'hub', data, success: true})
    } else {
      this.log(`BRV Hub (v${data.version}) - ${data.entries.length} entries\n`)
      this.log('| ID | Type | Version | Description | Category |')
      this.log('| --- | --- | --- | --- | --- |')

      for (const entry of data.entries) {
        this.log(this.formatEntry(entry))
      }

      this.log(`\nInstall: brv hub install <id>`)
    }
  }
}
