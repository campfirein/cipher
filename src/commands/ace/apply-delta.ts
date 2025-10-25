import {Args, Command} from '@oclif/core'
import {join} from 'node:path'

import {ApplyDeltaUseCase} from '../../core/usecases/apply-delta-use-case.js'
import {LoadPlaybookUseCase} from '../../core/usecases/load-playbook-use-case.js'
import {FilePlaybookStore} from '../../infra/ace/file-playbook-store.js'
import {findLatestFile, loadDeltaBatch} from '../../utils/ace-file-helpers.js'

export default class ApplyDelta extends Command {
  public static args = {
    deltaFile: Args.string({
      description: 'Specific delta file name to apply (defaults to latest)',
      required: false,
    }),
  }
  public static description = 'Apply delta operations from a delta file to the playbook'
  public static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> delta-test-hint-2025-10-25T04-59-00.902Z.json',
  ]

  // Protected methods for testability
  protected async findLatestDeltaFile(directory: string): Promise<string> {
    return findLatestFile(directory)
  }

  protected async loadDeltaBatchFile(filePath: string) {
    return loadDeltaBatch(filePath)
  }

  public async run(): Promise<void> {
    const {args} = await this.parse(ApplyDelta)

    try {
      // Step 1: Load delta file (either specified or latest)
      this.log('📋 Loading delta file...')
      const deltasDir = join(process.cwd(), '.br', 'ace', 'deltas')

      let deltaFile: string
      if (args.deltaFile) {
        // Use specified delta file
        deltaFile = join(deltasDir, args.deltaFile)
        this.log(`  Using specified delta: ${args.deltaFile}`)
      } else {
        // Find latest delta
        deltaFile = await this.findLatestDeltaFile(deltasDir)
        this.log(`  Using latest delta`)
      }

      const deltaBatch = await this.loadDeltaBatchFile(deltaFile)
      this.log(`  ✓ Loaded: ${deltaFile}`)

      // Step 2: Load playbook
      this.log('📚 Loading playbook...')
      const playbookStore = new FilePlaybookStore()
      const loadUseCase = new LoadPlaybookUseCase(playbookStore)
      const loadResult = await loadUseCase.execute()

      if (!loadResult.success) {
        this.error(loadResult.error || 'Failed to load playbook. Run `br ace init` to initialize.')
      }

      this.log('  ✓ Playbook loaded')

      // Step 3: Apply delta operations to playbook
      this.log('⚙️  Applying delta operations to playbook...')
      const applyUseCase = new ApplyDeltaUseCase(playbookStore)
      const applyResult = await applyUseCase.execute(deltaBatch)

      if (!applyResult.success) {
        this.error(applyResult.error || 'Failed to apply delta operations')
      }

      // Step 4: Display summary
      const operationsByType = deltaBatch.getOperationsByType()

      this.log('')
      this.log('✅ Delta operations applied successfully!')
      this.log('')
      this.log('Summary:')
      this.log(`  Delta file: ${deltaFile}`)
      this.log(`  Total operations: ${deltaBatch.getOperationCount()}`)
      this.log('')
      this.log('Operations applied:')

      if (operationsByType.ADD) {
        this.log(`  - ADD: ${operationsByType.ADD.length}`)
      }

      if (operationsByType.UPDATE) {
        this.log(`  - UPDATE: ${operationsByType.UPDATE.length}`)
      }

      if (operationsByType.REMOVE) {
        this.log(`  - REMOVE: ${operationsByType.REMOVE.length}`)
      }

      if (deltaBatch.isEmpty()) {
        this.log('  - No operations (empty delta batch)')
      }

      this.log('')
      this.log('Playbook has been updated!')
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Failed to apply delta operations')
    }
  }
}
