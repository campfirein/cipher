import {Args, Command} from '@oclif/core'
import * as fs from 'node:fs/promises'

import {DeltaBatch} from '../../core/domain/entities/delta-batch.js'
import {ApplyDeltaUseCase} from '../../core/usecases/apply-delta-use-case.js'
import {FilePlaybookStore} from '../../infra/ace/file-playbook-store.js'

export default class Apply extends Command {
  public static args = {
    deltaFile: Args.string({description: 'Path to delta JSON file', required: true}),
    directory: Args.string({description: 'Project directory (defaults to current directory)', required: false}),
  }
  public static description = 'Apply delta operations from a file to the local ACE playbook'
  public static examples = [
    '<%= config.bin %> <%= command.id %> delta.json',
    '<%= config.bin %> <%= command.id %> delta.json /path/to/project',
    '<%= config.bin %> <%= command.id %> .br/ace/deltas/curator-output.json',
  ]

  // Protected method for testability - can be overridden in tests
  protected async readDeltaFile(filePath: string): Promise<string> {
    return fs.readFile(filePath, 'utf8')
  }

  public async run(): Promise<void> {
    const {args} = await this.parse(Apply)

    try {
      // Read delta file
      const deltaContent = await this.readDeltaFile(args.deltaFile)
      const deltaJson = JSON.parse(deltaContent)

      // Parse delta batch
      const deltaBatch = DeltaBatch.fromJson(deltaJson)

      if (deltaBatch.isEmpty()) {
        this.log('No operations to apply (empty delta batch).')
        return
      }

      // Setup dependencies
      const playbookStore = new FilePlaybookStore()
      const useCase = new ApplyDeltaUseCase(playbookStore)

      // Execute apply
      this.log('Applying delta operations...')
      const result = await useCase.execute(deltaBatch, args.directory)

      if (!result.success) {
        this.error(result.error || 'Failed to apply delta')
      }

      // Display results
      this.log(`✓ Successfully applied ${result.operationsApplied} operation(s)`)
      this.log(`\nReasoning: ${deltaBatch.reasoning}`)

      // Show operation breakdown
      const opsByType = deltaBatch.getOperationsByType()
      if (Object.keys(opsByType).length > 0) {
        this.log('\nOperations applied:')
        for (const [type, ops] of Object.entries(opsByType)) {
          this.log(`  - ${type}: ${ops.length}`)
        }
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('ENOENT')) {
          this.error(`Delta file not found: ${args.deltaFile}`)
        } else if (error.message.includes('JSON')) {
          this.error(`Invalid JSON in delta file: ${error.message}`)
        } else {
          this.error(error.message)
        }
      } else {
        this.error('Failed to apply delta')
      }
    }
  }
}
