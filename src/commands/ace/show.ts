import {Args, Command, Flags} from '@oclif/core'

import {LoadPlaybookUseCase} from '../../core/usecases/load-playbook-use-case.js'
import {FilePlaybookStore} from '../../infra/ace/file-playbook-store.js'

export default class Show extends Command {
  public static args = {
    directory: Args.string({description: 'Project directory (defaults to current directory)', required: false}),
  }
public static description = 'Display local ACE context (ACE playbook) managed by ByteRover CLI'
public static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> /path/to/project',
    '<%= config.bin %> <%= command.id %> --format json',
  ]
public static flags = {
    format: Flags.string({
      char: 'f',
      default: 'markdown',
      description: 'Output format',
      options: ['markdown', 'json'],
    }),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(Show)

    try {
      // Setup dependencies
      const playbookStore = new FilePlaybookStore()
      const useCase = new LoadPlaybookUseCase(playbookStore)

      // Execute load
      const result = await useCase.execute(args.directory)

      if (!result.success) {
        this.error(result.error || 'Failed to load playbook')
      }

      // Display based on format
      if (flags.format === 'json') {
        this.log(JSON.stringify(result.playbook!.toJson(), null, 2))
      } else {
        // Markdown format
        const prompt = result.playbookPrompt!

        if (prompt === '(Empty playbook)') {
          this.log('Playbook is empty. Use ACE commands to add knowledge.')
        } else {
          this.log('# ACE Playbook\n')
          this.log(prompt)
        }
      }
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Failed to display playbook')
    }
  }
}
