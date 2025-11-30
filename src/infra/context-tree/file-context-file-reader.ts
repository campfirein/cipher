import {readFile} from 'node:fs/promises'
import {join} from 'node:path'

import type {ContextFileContent, IContextFileReader} from '../../core/interfaces/i-context-file-reader.js'

import {BRV_DIR, CONTEXT_TREE_DIR} from '../../constants.js'

export type FileContextFileReaderConfig = {
  baseDirectory?: string
}

/**
 * Extracts the title from the first markdown heading in the content.
 * @param content - The file content
 * @param fallbackTitle - The title to use if no heading is found
 * @returns The extracted title or fallback
 */
const extractTitle = (content: string, fallbackTitle: string): string => {
  // Match the first line that starts with "# " (level 1 heading)
  const match = /^# (.+)$/m.exec(content)
  return match ? match[1].trim() : fallbackTitle
}

/**
 * File-based implementation of IContextFileReader.
 * Reads context.md files from the context tree and extracts their metadata.
 */
export class FileContextFileReader implements IContextFileReader {
  private readonly config: FileContextFileReaderConfig

  public constructor(config: FileContextFileReaderConfig = {}) {
    this.config = config
  }

  public async read(relativePath: string, directory?: string): Promise<ContextFileContent | undefined> {
    const baseDir = directory ?? this.config.baseDirectory ?? process.cwd()
    const fullPath = join(baseDir, BRV_DIR, CONTEXT_TREE_DIR, relativePath)

    try {
      const content = await readFile(fullPath, 'utf8')
      const title = extractTitle(content, relativePath)

      return {
        content,
        path: relativePath,
        title,
      }
    } catch {
      // File doesn't exist or can't be read
      return undefined
    }
  }

  public async readMany(relativePaths: string[], directory?: string): Promise<ContextFileContent[]> {
    const results = await Promise.all(relativePaths.map((path) => this.read(path, directory)))

    // Filter out undefined results (files that couldn't be read)
    return results.filter((result): result is ContextFileContent => result !== undefined)
  }
}
