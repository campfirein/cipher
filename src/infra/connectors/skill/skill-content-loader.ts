import path from 'node:path'
import {fileURLToPath} from 'node:url'

import type {IFileService} from '../../../core/interfaces/i-file-service.js'

/**
 * Loads static skill markdown files from the templates/skill/ directory.
 * Uses the same import.meta.url path resolution pattern as FsTemplateLoader.
 */
export class SkillContentLoader {
  private readonly skillDir: string

  constructor(private readonly fileService: IFileService) {
    const currentFilePath = fileURLToPath(import.meta.url)
    const currentDir = path.dirname(currentFilePath)

    // Navigate from src/infra/connectors/skill/ to src/templates/skill/
    this.skillDir = path.join(currentDir, '..', '..', '..', 'templates', 'skill')
  }

  /**
   * Loads a skill file by name from the templates/skill/ directory.
   *
   * @param fileName - Name of the skill file (e.g., 'SKILL.md')
   * @returns Promise resolving to the file content
   * @throws Error if the file cannot be read
   */
  async loadSkillFile(fileName: string): Promise<string> {
    const fullPath = path.join(this.skillDir, fileName)

    try {
      return await this.fileService.read(fullPath)
    } catch (error) {
      throw new Error(
        `Failed to load skill file '${fileName}': ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}
