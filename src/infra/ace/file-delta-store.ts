import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import type {DeltaBatch} from '../../core/domain/entities/delta-batch.js'
import type {IDeltaStore} from '../../core/interfaces/i-delta-store.js'

import {DELTAS_DIR} from '../../constants.js'
import {ensureAceDirectory, generateTimestampedFilename} from './ace-file-utils.js'

/**
 * File-based implementation of IDeltaStore.
 * Stores delta batches as JSON files in .br/ace/deltas/ directory.
 */
export class FileDeltaStore implements IDeltaStore {
  public async save(deltaBatch: DeltaBatch, hint?: string, directory?: string): Promise<string> {
    try {
      // Ensure deltas directory exists
      const deltasDir = await ensureAceDirectory(directory, DELTAS_DIR)

      // Generate filename with optional hint and timestamp
      const filename = generateTimestampedFilename('delta', hint)
      const filePath = join(deltasDir, filename)

      // Serialize and save delta batch
      const content = JSON.stringify(deltaBatch.toJson(), null, 2)
      await writeFile(filePath, content, 'utf8')

      return filePath
    } catch (error) {
      throw new Error(`Failed to save delta batch: ${(error as Error).message}`)
    }
  }
}
