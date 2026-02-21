import {Args, Command, Flags} from '@oclif/core'

import type {AuthScheme} from '../../../../shared/transport/types/auth-scheme.js'

import {
  HubEvents,
  type HubRegistryAddRequest,
  type HubRegistryAddResponse,
} from '../../../../shared/transport/events/hub-events.js'
import {type DaemonClientOptions, formatConnectionError, withDaemonRetry} from '../../../lib/daemon-client.js'
import {writeJsonResponse} from '../../../lib/json-response.js'

export default class HubRegistryAdd extends Command {
  public static args = {
    name: Args.string({
      description: 'Registry name',
      required: true,
    }),
  }
  public static description = 'Add a hub registry'
  public static examples = [
    '<%= config.bin %> hub registry add myco --url https://example.com/registry.json',
    '<%= config.bin %> hub registry add myco --url https://example.com/registry.json --token secret',
    '<%= config.bin %> hub registry add ghrepo --url https://raw.githubusercontent.com/org/repo/main/registry.json --auth-scheme token --token ghp_xxx',
    '<%= config.bin %> hub registry add gitlab --url https://gitlab.com/.../registry.json --auth-scheme custom-header --header-name PRIVATE-TOKEN --token glpat-xxx',
  ]
  public static flags = {
    'auth-scheme': Flags.string({
      char: 's',
      description: 'Auth scheme for hub registry',
      options: ['bearer', 'token', 'basic', 'custom-header', 'none'],
    }),
    format: Flags.string({
      char: 'f',
      default: 'text',
      description: 'Output format',
      options: ['text', 'json'],
    }),
    'header-name': Flags.string({
      description: 'Custom header name (for custom-header auth scheme)',
    }),
    token: Flags.string({
      char: 't',
      description: 'Auth token for private hub registry',
    }),
    url: Flags.string({
      char: 'u',
      description: 'Registry URL',
      required: true,
    }),
  }

  protected async executeAdd(
    params: HubRegistryAddRequest,
    options?: DaemonClientOptions,
  ): Promise<HubRegistryAddResponse> {
    return withDaemonRetry<HubRegistryAddResponse>(
      async (client) =>
        client.requestWithAck<HubRegistryAddResponse, HubRegistryAddRequest>(HubEvents.REGISTRY_ADD, params),
      options,
    )
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(HubRegistryAdd)
    const format = flags.format as 'json' | 'text'

    try {
      const result = await this.executeAdd({
        authScheme: flags['auth-scheme'] as AuthScheme | undefined,
        headerName: flags['header-name'],
        name: args.name,
        token: flags.token,
        url: flags.url,
      })

      if (format === 'json') {
        writeJsonResponse({command: 'hub registry add', data: result, success: result.success})
      } else {
        this.log(result.message)
      }
    } catch (error) {
      if (format === 'json') {
        writeJsonResponse({command: 'hub registry add', data: {error: formatConnectionError(error)}, success: false})
      } else {
        this.log(formatConnectionError(error))
      }
    }
  }
}
