import {mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import type {DeltaBatchJson} from '../domain/entities/delta-batch.js'

import {CuratorOutput} from '../domain/entities/curator-output.js'
import {DeltaBatch} from '../domain/entities/delta-batch.js'

export interface ParseCuratorOutputResult {
  curatorOutput?: CuratorOutput
  error?: string
  filePath?: string
  success: boolean
}

/**
 * Use case for parsing and saving curator output from agent.
 * Validates delta operations and stores to .br/ace/deltas/{timestamp}.json
 */
export class ParseCuratorOutputUseCase {
  private static readonly ACE_DIR = 'ace'
  private static readonly BR_DIR = '.br'
  private static readonly DELTAS_DIR = 'deltas'

  public async execute(curatorJson: DeltaBatchJson, directory?: string): Promise<ParseCuratorOutputResult> {
    try {
      // Parse and validate delta batch
      const deltaBatch = DeltaBatch.fromJson(curatorJson)
      const curatorOutput = new CuratorOutput(deltaBatch)

      // Prepare output directory
      const baseDir = directory ?? process.cwd()
      const deltasDir = join(
        baseDir,
        ParseCuratorOutputUseCase.BR_DIR,
        ParseCuratorOutputUseCase.ACE_DIR,
        ParseCuratorOutputUseCase.DELTAS_DIR,
      )

      // Ensure directory exists
      await mkdir(deltasDir, {recursive: true})

      // Generate filename with timestamp
      const timestamp = new Date().toISOString().replaceAll(':', '-')
      const filename = `delta-${timestamp}.json`
      const filePath = join(deltasDir, filename)

      // Serialize and save (save the delta batch directly)
      const content = JSON.stringify(deltaBatch.toJson(), null, 2)
      await writeFile(filePath, content, 'utf8')

      return {
        curatorOutput,
        filePath,
        success: true,
      }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Failed to parse curator output',
        success: false,
      }
    }
  }
}
