import {existsSync} from 'node:fs'
import {mkdir, readFile, unlink, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import type {IPlaybookStore} from '../../core/interfaces/i-playbook-store.js'

import {Playbook} from '../../core/domain/entities/playbook.js'
import {PlaybookNotFoundError} from '../../core/domain/errors/ace-error.js'

/**
 * File-based implementation of IPlaybookStore.
 * Stores playbook in .br/ace/playbook.json in the project directory.
 */
export class FilePlaybookStore implements IPlaybookStore {
  private static readonly ACE_DIR = 'ace'
  private static readonly BR_DIR = '.br'
  private static readonly PLAYBOOK_FILE = 'playbook.json'

  public async clear(directory?: string): Promise<void> {
    const exists = await this.exists(directory)

    if (!exists) {
      return
    }

    const emptyPlaybook = new Playbook()
    await this.save(emptyPlaybook, directory)
  }

  public async delete(directory?: string): Promise<void> {
    const playbookPath = this.getPlaybookPath(directory)

    if (!existsSync(playbookPath)) {
      return
    }

    try {
      await unlink(playbookPath)
    } catch (error) {
      throw new Error(`Failed to delete playbook at ${playbookPath}: ${(error as Error).message}`)
    }
  }

  public async exists(directory?: string): Promise<boolean> {
    const playbookPath = this.getPlaybookPath(directory)
    return existsSync(playbookPath)
  }

  public async load(directory?: string): Promise<Playbook | undefined> {
    const playbookPath = this.getPlaybookPath(directory)

    if (!existsSync(playbookPath)) {
      return undefined
    }

    try {
      const content = await readFile(playbookPath, 'utf8')
      return Playbook.loads(content)
    } catch (error) {
      throw new PlaybookNotFoundError(
        `Failed to load playbook from ${playbookPath}: ${(error as Error).message}`,
      )
    }
  }

  public async save(playbook: Playbook, directory?: string): Promise<void> {
    const aceDirPath = this.getAceDirPath(directory)
    const playbookPath = this.getPlaybookPath(directory)

    try {
      // Create .br/ace directory if it doesn't exist
      await mkdir(aceDirPath, {recursive: true})

      // Write playbook.json
      const content = playbook.dumps()
      await writeFile(playbookPath, content, 'utf8')
    } catch (error) {
      throw new Error(`Failed to save playbook to ${playbookPath}: ${(error as Error).message}`)
    }
  }

  /**
   * Gets the full path to the .br/ace directory
   */
  private getAceDirPath(directory?: string): string {
    return join(this.getBrDirPath(directory), FilePlaybookStore.ACE_DIR)
  }

  /**
   * Gets the full path to the .br directory
   */
  private getBrDirPath(directory?: string): string {
    const baseDir = directory ?? process.cwd()
    return join(baseDir, FilePlaybookStore.BR_DIR)
  }

  /**
   * Gets the full path to the playbook.json file
   */
  private getPlaybookPath(directory?: string): string {
    return join(this.getAceDirPath(directory), FilePlaybookStore.PLAYBOOK_FILE)
  }
}
