import {confirm} from '@inquirer/prompts'
import {Args, Command, Flags} from '@oclif/core'

import {Playbook} from '../core/domain/entities/playbook.js'
import {FilePlaybookStore} from '../infra/ace/file-playbook-store.js'

export default class Clear extends Command {
  public static args = {
    directory: Args.string({description: 'Project directory (defaults to current directory)', required: false}),
  }
  public static description = 'Clear local ACE context (playbook) managed by ByteRover CLI'
  public static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --yes',
    '<%= config.bin %> <%= command.id %> /path/to/project',
  ]
  public static flags = {
    yes: Flags.boolean({
      char: 'y',
      default: false,
      description: 'Skip confirmation prompt',
    }),
  }

  // Protected method for testability - can be overridden in tests
  protected async confirmClear(): Promise<boolean> {
    return confirm({
      default: false,
      message: 'Are you sure you want to clear the playbook? This action cannot be undone.',
    })
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(Clear)

    try {
      // Setup dependencies
      const playbookStore = new FilePlaybookStore()

      // Check if playbook exists
      const exists = await playbookStore.exists(args.directory)

      if (!exists) {
        this.log('No playbook found. Nothing to clear.')
        return
      }

      // Confirmation prompt (unless --yes flag is used)
      if (!flags.yes) {
        const confirmed = await this.confirmClear()

        if (!confirmed) {
          this.log('Cancelled. Playbook was not cleared.')
          return
        }
      }

      // Reset the playbook to empty structure
      const emptyPlaybook = new Playbook()
      await playbookStore.save(emptyPlaybook, args.directory)

      this.log('✓ Playbook cleared successfully.')
    } catch (error) {
      // Handle user cancelling the prompt (Ctrl+C or closing stdin)
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (errorMessage.includes('User force closed') || errorMessage.includes('force closed')) {
        this.log('Cancelled. Playbook was not cleared.')
        return
      }

      // For other errors, throw to let oclif handle display
      this.error(error instanceof Error ? error.message : 'Failed to clear playbook')
    }
  }
}
