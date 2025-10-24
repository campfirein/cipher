import {Command} from '@oclif/core'

import {InitializePlaybookUseCase} from '../../core/usecases/initialize-playbook-use-case.js'
import {FilePlaybookStore} from '../../infra/ace/file-playbook-store.js'

export default class Init extends Command {
  public static description = 'Initialize local ACE context in .br/ace/ (managed by ByteRover CLI)'
  public static examples = [
    '<%= config.bin %> <%= command.id %>',
  ]

  public async run(): Promise<void> {
    try {
      // Setup dependencies
      const playbookStore = new FilePlaybookStore()
      const useCase = new InitializePlaybookUseCase(playbookStore)

      this.log('Setting up local ACE context (.br/ace/) managed by ByteRover CLI...')

      // Execute initialization
      const result = await useCase.execute()

      if (result.success) {
        this.log(`✓ ACE playbook initialized in ${result.playbookPath}`)
        this.log('This creates a local project context that ByteRover CLI uses to manage ACE workflows.')
        this.log('\nDirectory structure created:')
        this.log('  .br/ace/')
        this.log('    ├── playbook.json')
        this.log('    ├── reflections/')
        this.log('    ├── executor-outputs/')
        this.log('    ├── deltas/')
        this.log('    └── prompts/')
        this.log('\nYou can now use ACE commands to manage your playbook.')
      } else {
        this.error(result.error || 'Failed to initialize playbook')
      }
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Failed to initialize playbook')
    }
  }
}
