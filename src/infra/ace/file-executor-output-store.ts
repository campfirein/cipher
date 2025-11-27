// TODO: Will deprecate. Replaced by Context Tree

import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import type {ExecutorOutput} from '../../core/domain/entities/executor-output.js'
import type {IExecutorOutputStore} from '../../core/interfaces/i-executor-output-store.js'

import {EXECUTOR_OUTPUTS_DIR} from '../../constants.js'
import {ensureAceDirectory, generateTimestampedFilename} from './ace-file-utils.js'

/**
 * File-based implementation of IExecutorOutputStore.
 * Stores executor outputs as JSON files in .brv/ace/executor-outputs/ directory.
 */
export class FileExecutorOutputStore implements IExecutorOutputStore {
  public async save(output: ExecutorOutput, directory?: string): Promise<string> {
    try {
      // Ensure executor-outputs directory exists
      const outputDir = await ensureAceDirectory(directory, EXECUTOR_OUTPUTS_DIR)

      // Generate filename with hint from executor output and timestamp
      const filename = generateTimestampedFilename('executor', output.hint || undefined)
      const filePath = join(outputDir, filename)

      // Serialize and save executor output
      const content = JSON.stringify(output.toJson(), null, 2)
      await writeFile(filePath, content, 'utf8')

      return filePath
    } catch (error) {
      throw new Error(`Failed to save executor output: ${(error as Error).message}`)
    }
  }
}
