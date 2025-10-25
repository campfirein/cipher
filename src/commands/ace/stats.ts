import {Args, Command, Flags} from '@oclif/core'

import {LoadPlaybookUseCase} from '../../core/usecases/load-playbook-use-case.js'
import {FilePlaybookStore} from '../../infra/ace/file-playbook-store.js'

export default class Stats extends Command {
  public static args = {
    directory: Args.string({description: 'Project directory (defaults to current directory)', required: false}),
  }
  public static description = 'Display statistics for local ACE context (playbook) managed by ByteRover CLI'
  public static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> /path/to/project',
    '<%= config.bin %> <%= command.id %> --format json',
  ]
  public static flags = {
    format: Flags.string({
      char: 'f',
      default: 'table',
      description: 'Output format',
      options: ['table', 'json'],
    }),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(Stats)

    try {
      // Setup dependencies
      const playbookStore = new FilePlaybookStore()
      const useCase = new LoadPlaybookUseCase(playbookStore)

      // Execute load
      const result = await useCase.execute(args.directory)

      if (!result.success) {
        this.error(result.error || 'Failed to load playbook')
      }

      // Get statistics
      const stats = result.playbook!.stats()

      // Display based on format
      if (flags.format === 'json') {
        this.log(JSON.stringify(stats, null, 2))
      } else {
        // Table format
        this.log('# ACE Playbook Statistics\n')
        this.log(`Sections:  ${stats.sections}`)
        this.log(`Bullets:   ${stats.bullets}`)
        this.log(`Tags:      ${stats.tags.length}`)

        if (stats.tags.length > 0) {
          this.log('\n## Tags')
          for (const tag of stats.tags) {
            this.log(`  - ${tag}`)
          }
        }
      }
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Failed to load playbook statistics')
    }
  }
}
