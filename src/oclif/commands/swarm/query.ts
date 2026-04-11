import {Args, Command, Flags} from '@oclif/core'

import {FileSystemService} from '../../../agent/infra/file-system/file-system-service.js'
import {formatQueryResults, formatQueryResultsJson} from '../../../agent/infra/swarm/cli/query-renderer.js'
import {loadSwarmConfig} from '../../../agent/infra/swarm/config/swarm-config-loader.js'
import {buildProvidersFromConfig} from '../../../agent/infra/swarm/provider-factory.js'
import {SwarmCoordinator} from '../../../agent/infra/swarm/swarm-coordinator.js'
import {createSearchKnowledgeService} from '../../../agent/infra/tools/implementations/search-knowledge-service.js'

export default class SwarmQuery extends Command {
  public static args = {
    query: Args.string({description: 'Natural language query to search across memory providers', required: true}),
  }
public static description = 'Query the memory swarm across all active providers'
  public static examples = [
    '<%= config.bin %> swarm query "auth tokens"',
    '<%= config.bin %> swarm query "what changed yesterday" --format json',
  ]
  public static flags = {
    format: Flags.string({
      char: 'f',
      default: 'text',
      description: 'Output format',
      options: ['text', 'json'],
    }),
    'max-results': Flags.integer({
      char: 'n',
      description: 'Maximum number of results',
    }),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(SwarmQuery)
    const isJson = flags.format === 'json'

    try {
      const config = await loadSwarmConfig(process.cwd())

      // Build a real SearchKnowledgeService so ByteRover can search the context tree.
      // FileSystemService is lightweight — safe to construct here for CLI use.
      const workingDirectory = process.cwd()
      const fileSystemService = new FileSystemService({workingDirectory})
      await fileSystemService.initialize()
      const searchService = createSearchKnowledgeService(fileSystemService, {
        baseDirectory: workingDirectory,
      })

      const providers = buildProvidersFromConfig(config, {searchService})

      const coordinator = new SwarmCoordinator(providers, config)

      // Run health checks so unhealthy providers are skipped
      await coordinator.refreshHealth()

      const result = await coordinator.execute({
        maxResults: flags['max-results'],
        query: args.query,
      })

      if (isJson) {
        this.log(formatQueryResultsJson(result))
      } else {
        this.log(formatQueryResults(result, args.query))
      }
    } catch (error) {
      if (isJson) {
        this.log(JSON.stringify({error: (error as Error).message, success: false}))
      } else {
        this.error((error as Error).message)
      }
    }
  }
}
