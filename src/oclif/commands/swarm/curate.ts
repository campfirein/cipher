import {Args, Command, Flags} from '@oclif/core'

import {FileSystemService} from '../../../agent/infra/file-system/file-system-service.js'
import {loadSwarmConfig} from '../../../agent/infra/swarm/config/swarm-config-loader.js'
import {buildProvidersFromConfig} from '../../../agent/infra/swarm/provider-factory.js'
import {SwarmCoordinator} from '../../../agent/infra/swarm/swarm-coordinator.js'
import {validateSwarmProviders} from '../../../agent/infra/swarm/validation/config-validator.js'
import {createSearchKnowledgeService} from '../../../agent/infra/tools/implementations/search-knowledge-service.js'

export default class SwarmCurate extends Command {
  public static args = {
    content: Args.string({description: 'Knowledge content to store in a swarm provider', required: true}),
  }
public static description = 'Store knowledge in a swarm provider (GBrain, local markdown)'
  public static examples = [
    '<%= config.bin %> swarm curate "Dario Amodei is CEO of Anthropic"',
    '<%= config.bin %> swarm curate "meeting notes: decided on JWT" --provider local-markdown:notes',
    '<%= config.bin %> swarm curate "Architecture uses event sourcing" --provider gbrain',
  ]
  public static flags = {
    format: Flags.string({
      char: 'f',
      default: 'text',
      description: 'Output format',
      options: ['text', 'json'],
    }),
    provider: Flags.string({
      char: 'p',
      description: 'Target provider ID (e.g., gbrain, local-markdown:notes)',
    }),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(SwarmCurate)
    const isJson = flags.format === 'json'

    try {
      const config = await loadSwarmConfig(process.cwd())

      // Validate enrichment topology only (provider errors handled by health checks)
      const validation = await validateSwarmProviders(config)
      const topologyErrors = validation.errors.filter((e) => e.provider === 'enrichment')
      if (topologyErrors.length > 0) {
        const messages = topologyErrors.map((e) => e.message)
        throw new Error(`Invalid enrichment topology:\n  ${messages.join('\n  ')}`)
      }

      const workingDirectory = process.cwd()
      const fileSystemService = new FileSystemService({workingDirectory})
      await fileSystemService.initialize()
      const searchService = createSearchKnowledgeService(fileSystemService, {
        baseDirectory: workingDirectory,
      })

      const providers = buildProvidersFromConfig(config, {searchService})
      const coordinator = new SwarmCoordinator(providers, config)
      await coordinator.refreshHealth()

      const result = await coordinator.store({
        content: args.content,
        provider: flags.provider,
      })

      if (isJson) {
        this.log(JSON.stringify(result, undefined, 2))
      } else if (result.success && result.fallback) {
        const idPart = result.id ? ` as ${result.id}` : ''
        this.log(`Stored to ${result.provider} (fallback — no external providers available)${idPart}`)
      } else if (result.success) {
        this.log(`Stored to ${result.provider} as ${result.id}`)
      } else {
        this.logToStderr(`Error: ${result.error ?? 'Store failed'}`)
        this.exit(2)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (isJson) {
        this.log(JSON.stringify({error: message, success: false}))
      } else {
        this.logToStderr(`Error: ${message}`)
        this.exit(2)
      }
    }
  }
}
