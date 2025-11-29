// TODO: Will deprecate. Replaced by Context Tree

import {readdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import type {IReflectionStore} from '../../core/interfaces/i-reflection-store.js'

import {REFLECTIONS_DIR} from '../../constants.js'
import {ReflectorOutput} from '../../core/domain/entities/reflector-output.js'
import {getErrorMessage} from '../../utils/error-helpers.js'
import {ensureAceDirectory, generateTimestampedFilename} from './ace-file-utils.js'

/**
 * File-based implementation of IReflectionStore.
 * Stores reflections as JSON files in .brv/ace/reflections/ directory.
 */
export class FileReflectionStore implements IReflectionStore {
  public async loadRecent(directory?: string, count: number = 3): Promise<ReflectorOutput[]> {
    try {
      // Get reflections directory path
      const reflectionsDir = await ensureAceDirectory(directory, REFLECTIONS_DIR)

      // Read all reflection files
      const files = await readdir(reflectionsDir)
      const reflectionFiles = files
        .filter((f) => f.endsWith('.json'))
        .sort()
        .reverse() // Most recent first (assuming timestamped filenames)
        .slice(0, count)

      // Load and parse reflections
      const reflections = await Promise.all(
        reflectionFiles.map(async (file) => {
          const filePath = join(reflectionsDir, file)
          const content = await readFile(filePath, 'utf8')
          const json = JSON.parse(content)
          return ReflectorOutput.fromJson(json)
        }),
      )

      return reflections
    } catch (error) {
      // If reflections directory doesn't exist or is empty, return empty array
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return []
      }

      throw new Error(`Failed to load recent reflections: ${getErrorMessage(error)}`)
    }
  }

  public async save(reflection: ReflectorOutput, directory?: string): Promise<string> {
    try {
      // Ensure reflections directory exists
      const reflectionsDir = await ensureAceDirectory(directory, REFLECTIONS_DIR)

      // Generate filename with hint from reflection and timestamp
      const filename = generateTimestampedFilename('reflection', reflection.hint || undefined)
      const filePath = join(reflectionsDir, filename)

      // Serialize and save reflection
      const content = JSON.stringify(reflection.toJson(), null, 2)
      await writeFile(filePath, content, 'utf8')

      return filePath
    } catch (error) {
      throw new Error(`Failed to save reflection: ${getErrorMessage(error)}`)
    }
  }
}
