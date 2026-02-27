import {Command, Flags} from '@oclif/core'
import chalk from 'chalk'

import {ModelEvents, type ModelListByProvidersResponse} from '../../../shared/transport/events/model-events.js'
import {
  ProviderEvents,
  type ProviderGetActiveResponse,
  type ProviderListResponse,
} from '../../../shared/transport/events/provider-events.js'
import {type DaemonClientOptions, formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'

export default class ModelList extends Command {
  public static description = 'List available models from all connected providers'
  public static examples = ['<%= config.bin %> model list', '<%= config.bin %> model list --format json']
  public static flags = {
    format: Flags.string({
      default: 'text',
      description: 'Output format (text or json)',
      options: ['text', 'json'],
    }),
    provider: Flags.string({
      char: 'p',
      description: 'Only list models for a specific provider',
    }),
  }

  protected async fetchModels(providerFlag?: string, options?: DaemonClientOptions) {
    return withDaemonRetry(async (client) => {
      const active = await client.requestWithAck<ProviderGetActiveResponse>(ProviderEvents.GET_ACTIVE)
      const {providers} = await client.requestWithAck<ProviderListResponse>(ProviderEvents.LIST)

      let providerIds: string[]
      if (providerFlag) {
        const provider = providers.find((provider) => provider.id === providerFlag)
        if (!provider) {
          throw new Error(`Unknown provider "${providerFlag}". Run "brv providers list" to see available providers.`)
        }

        if (!provider.isConnected) {
          throw new Error(
            `Provider "${providerFlag}" is not connected. Run "brv provider connect ${providerFlag}" first.`,
          )
        }

        providerIds = [providerFlag]
      } else {
        providerIds = providers.filter((provider) => provider.isConnected).map((provider) => provider.id)
      }

      const {models} = await client.requestWithAck<ModelListByProvidersResponse>(ModelEvents.LIST_BY_PROVIDERS, {
        providerIds,
      })

      return {activeModel: active.activeModel, activeProviderId: active.activeProviderId, models}
    }, options)
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(ModelList)
    const format = flags.format as 'json' | 'text'

    try {
      const result = await this.fetchModels(flags.provider)

      if (format === 'json') {
        writeJsonResponse({command: 'model list', data: result, success: true})
        return
      }

      if (result.models.length === 0) {
        this.log(
          'No models available. Run "brv provider list" to see available providers, then "brv provider connect <provider-id>" to connect one.',
        )
        return
      }

      const grouped = new Map<string, typeof result.models>()
      for (const model of result.models) {
        const group = grouped.get(model.providerId) ?? []
        group.push(model)
        grouped.set(model.providerId, group)
      }

      for (const [providerId, models] of grouped) {
        this.log(`${providerId}:`)
        for (const model of models) {
          const isCurrent = model.id === result.activeModel && model.providerId === result.activeProviderId
          const status = isCurrent ? chalk.green('(current)') : ''
          this.log(`    ${model.name} [${model.id}] ${status}`.trimEnd())
        }
      }
    } catch (error) {
      if (format === 'json') {
        writeJsonResponse({command: 'model list', data: {error: formatConnectionError(error)}, success: false})
      } else {
        this.log(formatConnectionError(error))
      }
    }
  }
}
