import {Args, Command} from '@oclif/core'

import type {LoadedSwarm, SwarmSummary} from '../../../agent/infra/swarm/types.js'

import {SwarmValidationError} from '../../../agent/infra/swarm/errors.js'
import {buildSwarmGraph} from '../../../agent/infra/swarm/swarm-graph-builder.js'
import {SwarmLoader} from '../../../agent/infra/swarm/swarm-loader.js'

export default class SwarmLoad extends Command {
  public static args = {
    dir: Args.string({
      description: 'Path to swarm spec directory',
      required: true,
    }),
  }
  public static description = 'Load and validate a swarm specification'
  public static examples = [
    '<%= config.bin %> swarm load ./my-swarm',
  ]

  protected createBuilder(): typeof buildSwarmGraph {
    return buildSwarmGraph
  }

  protected createLoader(): SwarmLoader {
    return new SwarmLoader()
  }

  public async run(): Promise<void> {
    const {args} = await this.parse(SwarmLoad)

    let loaded: LoadedSwarm
    try {
      loaded = await this.createLoader().load(args.dir)
    } catch (error) {
      if (error instanceof SwarmValidationError) {
        for (const w of error.warnings) {
          this.log(`Warning: ${w}`)
        }

        for (const e of error.errors) {
          this.log(`Error: ${e}`)
        }

        if (error.note) {
          this.log(`\n${error.note}`)
        }

        this.log(`\n${error.errors.length} error(s) found.`)
        this.exit(1)
      }

      throw error
    }

    const {summary} = this.createBuilder()(loaded)

    for (const w of loaded.warnings) {
      this.log(`Warning: ${w}`)
    }

    this.printSummary(summary)
  }

  private printSummary(s: SwarmSummary): void {
    this.log(`Swarm "${s.name}" (${s.slug})`)
    this.log(`  Agents: ${s.agentCount}`)
    for (const a of s.agents) {
      this.log(`    - ${a.slug} [${a.adapterType}]`)
    }

    this.log(`  Fixed edges: ${s.fixedEdgeCount}`)
    this.log(`  Potential edges: ${s.potentialEdgeCount}`)
    if (s.outputNodes.length > 0) {
      this.log(`  Output nodes: ${s.outputNodes.join(', ')}`)
    }
  }
}
