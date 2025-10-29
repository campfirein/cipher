import {Args, Command, Flags} from '@oclif/core'

import type {IPlaybookStore} from '../../core/interfaces/i-playbook-store.js'

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

  protected createServices(): {
    playbookStore: IPlaybookStore
  } {
    return {
      playbookStore: new FilePlaybookStore(),
    }
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(Show)

    try {
      const {playbookStore} = this.createServices()

      // Load playbook directly using service
      const playbook = await playbookStore.load(args.directory)

      if (!playbook) {
        this.error('Playbook not found. Run `br init` to initialize.')
      }

      // Display based on format
      if (flags.format === 'json') {
        this.log(JSON.stringify(playbook.toJson(), null, 2))
      } else {
        // Markdown format
        const prompt = playbook.asPrompt()

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
