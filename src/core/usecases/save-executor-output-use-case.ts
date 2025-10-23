import {mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import type {ExecutorOutput} from '../domain/entities/executor-output.js'

export interface SaveExecutorOutputResult {
  error?: string
  filePath?: string
  success: boolean
}

/**
 * Use case for saving executor output to disk.
 * Stores output in .br/ace/executor-outputs/{timestamp}.json
 */
export class SaveExecutorOutputUseCase {
  private static readonly ACE_DIR = 'ace'
  private static readonly BR_DIR = '.br'
  private static readonly EXECUTOR_OUTPUTS_DIR = 'executor-outputs'

  public async execute(
    executorOutput: ExecutorOutput,
    directory?: string,
  ): Promise<SaveExecutorOutputResult> {
    try {
      const baseDir = directory ?? process.cwd()
      const outputDir = join(
        baseDir,
        SaveExecutorOutputUseCase.BR_DIR,
        SaveExecutorOutputUseCase.ACE_DIR,
        SaveExecutorOutputUseCase.EXECUTOR_OUTPUTS_DIR,
      )

      // Ensure directory exists
      await mkdir(outputDir, {recursive: true})

      // Generate filename with timestamp
      const timestamp = new Date().toISOString().replaceAll(':', '-')
      const filename = `executor-${timestamp}.json`
      const filePath = join(outputDir, filename)

      // Serialize and save
      const content = JSON.stringify(executorOutput.toJson(), null, 2)
      await writeFile(filePath, content, 'utf8')

      return {
        filePath,
        success: true,
      }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Failed to save executor output',
        success: false,
      }
    }
  }
}
