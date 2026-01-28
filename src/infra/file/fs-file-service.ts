import {access, appendFile, copyFile, mkdir, readFile, rm, unlink, writeFile} from 'node:fs/promises'
import {dirname} from 'node:path'

import {type IFileService, type WriteMode} from '../../core/interfaces/i-file-service.js'

/**
 * File service implementation using Node.js fs module.
 */
export class FsFileService implements IFileService {
  public async createBackup(filePath: string): Promise<string> {
    try {
      // Timestamp format: YYYY-MM-DD-HH-MM-SS
      const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-').split('T').join('-').slice(0, -5)
      const backupPath = `${filePath}.backup-${timestamp}`
      await copyFile(filePath, backupPath)
      return backupPath
    } catch (error) {
      throw new Error(
        `Failed to create backup file '${filePath}': ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }

  /**
   * Deletes a file at the specified path.
   *
   * @param filePath The path to the file to delete.
   * @returns A promise that resolves when the file has been deleted.
   */
  public async delete(filePath: string): Promise<void> {
    try {
      await unlink(filePath)
    } catch (error) {
      throw new Error(
        `Failed to delete file '${filePath}': ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }

  /**
   * Deletes a directory and all its contents recursively.
   *
   * @param dirPath The path to the directory to delete.
   * @returns A promise that resolves when the directory has been deleted.
   */
  public async deleteDirectory(dirPath: string): Promise<void> {
    try {
      await rm(dirPath, {force: true, recursive: true})
    } catch (error) {
      throw new Error(
        `Failed to delete directory '${dirPath}': ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }

  /**
   * Checks if a file exists at the specified path.
   *
   * @param filePath The path to the file to check.
   * @returns A promise that resolves with `true` if the file exists, `false` otherwise.
   */
  public async exists(filePath: string): Promise<boolean> {
    try {
      await access(filePath)
      return true
    } catch {
      return false
    }
  }

  /**
   * Reads content from the specified file.
   *
   * @param filePath The path to the file to read from.
   * @returns A promise that resolves with the content of the file.
   */
  public async read(filePath: string): Promise<string> {
    try {
      return await readFile(filePath, 'utf8')
    } catch (error) {
      throw new Error(
        `Failed to read content from file '${filePath}': ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  public async replaceContent(filePath: string, oldContent: string, newContent: string): Promise<void> {
    try {
      const currentContent = await this.read(filePath)
      const updatedContent = currentContent.replace(oldContent, newContent)
      await this.write(updatedContent, filePath, 'overwrite')
    } catch (error) {
      throw new Error(
        `Failed to replace content in file '${filePath}': ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }

  /**
   * Writes content to the specified file.
   * @param content The content to write.
   * @param filePath The path to the file to write to.
   * @param mode The mode to write the content in ('append' or 'overwrite').
   * @returns A promise that resolves when the content has been written.
   */
  public async write(content: string, filePath: string, mode: WriteMode): Promise<void> {
    try {
      // Ensure directory exists
      const directory = dirname(filePath)
      await mkdir(directory, {recursive: true})

      // Write writeOperation
      const writeOperation =
        mode === 'append' ? appendFile(filePath, content, 'utf8') : writeFile(filePath, content, 'utf8')

      // Execute writeOperation
      await writeOperation
    } catch (error) {
      throw new Error(
        `Failed to ${mode} content to file '${filePath}': ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}
