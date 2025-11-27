// TODO: Will deprecate. Replaced by Context Tree

import {existsSync} from 'node:fs'
import {mkdir, readFile, unlink, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import type {IBulletContentStore} from '../../core/interfaces/i-bullet-content-store.js'

import {ACE_DIR, BRV_DIR, BULLETS_DIR} from '../../constants.js'

/**
 * File-based implementation of IBulletContentStore.
 * Stores bullet content in .brv/ace/bullets/{bullet-id}.md files.
 */
export class FileBulletContentStore implements IBulletContentStore {
  public async delete(bulletId: string, directory?: string): Promise<void> {
    const contentPath = this.getContentPath(bulletId, directory)

    if (!existsSync(contentPath)) {
      return
    }

    try {
      await unlink(contentPath)
    } catch (error) {
      throw new Error(`Failed to delete bullet content at ${contentPath}: ${(error as Error).message}`)
    }
  }

  public async exists(bulletId: string, directory?: string): Promise<boolean> {
    const contentPath = this.getContentPath(bulletId, directory)
    return existsSync(contentPath)
  }

  public async load(bulletId: string, directory?: string): Promise<string | undefined> {
    const contentPath = this.getContentPath(bulletId, directory)

    if (!existsSync(contentPath)) {
      return undefined
    }

    try {
      const rawContent = await readFile(contentPath, 'utf8')

      // Strip the warning header if present
      const headerPattern = /^<!--\s*\nWARNING:.*?-->\n\n/s
      const content = rawContent.replace(headerPattern, '')

      return content
    } catch (error) {
      throw new Error(`Failed to load bullet content from ${contentPath}: ${(error as Error).message}`)
    }
  }

  public async save(bulletId: string, content: string, directory?: string): Promise<string> {
    const bulletsDirPath = this.getBulletsDirPath(directory)
    const contentPath = this.getContentPath(bulletId, directory)

    try {
      // Create .brv/ace/bullets directory if it doesn't exist
      await mkdir(bulletsDirPath, {recursive: true})

      // Add warning header to content
      const header = `<!--
WARNING: Do not rename this file manually!
File name: ${bulletId}.md
This file is managed by ByteRover CLI. Only edit the content below.
Renaming this file will break the link to the playbook metadata.
-->\n\n`

      const contentWithHeader = header + content

      // Write content file with header
      await writeFile(contentPath, contentWithHeader, 'utf8')

      return contentPath
    } catch (error) {
      throw new Error(`Failed to save bullet content to ${contentPath}: ${(error as Error).message}`)
    }
  }

  /**
   * Gets the full path to the .brv/ace directory
   */
  private getAceDirPath(directory?: string): string {
    return join(this.getBrDirPath(directory), ACE_DIR)
  }

  /**
   * Gets the full path to the .brv directory
   */
  private getBrDirPath(directory?: string): string {
    const baseDir = directory ?? process.cwd()
    return join(baseDir, BRV_DIR)
  }

  /**
   * Gets the full path to the .brv/ace/bullets directory
   */
  private getBulletsDirPath(directory?: string): string {
    return join(this.getAceDirPath(directory), BULLETS_DIR)
  }

  /**
   * Gets the full path to a bullet content file
   */
  private getContentPath(bulletId: string, directory?: string): string {
    return join(this.getBulletsDirPath(directory), `${bulletId}.md`)
  }
}
