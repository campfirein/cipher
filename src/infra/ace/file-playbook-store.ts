// TODO: will deprecate. Replaced by Context Tree

import {existsSync} from 'node:fs'
import {mkdir, readFile, unlink, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import type {IBulletContentStore} from '../../core/interfaces/i-bullet-content-store.js'
import type {IPlaybookStore} from '../../core/interfaces/i-playbook-store.js'

import {ACE_DIR, BRV_DIR} from '../../constants.js'
import {Playbook} from '../../core/domain/entities/playbook.js'
import {PlaybookNotFoundError} from '../../core/domain/errors/ace-error.js'
import {getErrorMessage} from '../../utils/error-helpers.js'
import {FileBulletContentStore} from './file-bullet-content-store.js'

/**
 * File-based implementation of IPlaybookStore.
 * Stores playbook metadata in .brv/ace/playbook.json and bullet content in .brv/ace/bullets/{id}.md files.
 */
export class FilePlaybookStore implements IPlaybookStore {
  private static readonly PLAYBOOK_FILE = 'playbook.json'
  private readonly contentStore: IBulletContentStore

  public constructor(contentStore?: IBulletContentStore) {
    this.contentStore = contentStore ?? new FileBulletContentStore()
  }

  public async clear(directory?: string): Promise<void> {
    const exists = await this.exists(directory)

    if (!exists) {
      return
    }

    // Load existing playbook to get bullet IDs
    const playbook = await this.load(directory)
    if (playbook) {
      // Delete all bullet content files
      const bullets = playbook.getBullets()
      await Promise.all(bullets.map((bullet) => this.contentStore.delete(bullet.id, directory)))
    }

    // Save empty playbook
    const emptyPlaybook = new Playbook()
    await this.save(emptyPlaybook, directory)
  }

  public async delete(directory?: string): Promise<void> {
    const playbookPath = this.getPlaybookPath(directory)

    if (!existsSync(playbookPath)) {
      return
    }

    try {
      // Load playbook to get bullet IDs
      const playbook = await this.load(directory)
      if (playbook) {
        // Delete all bullet content files
        const bullets = playbook.getBullets()
        await Promise.all(bullets.map((bullet) => this.contentStore.delete(bullet.id, directory)))
      }

      // Delete playbook.json
      await unlink(playbookPath)
    } catch (error) {
      throw new Error(`Failed to delete playbook at ${playbookPath}: ${getErrorMessage(error)}`)
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
      return await Playbook.loads(content, this.contentStore, directory)
    } catch (error) {
      throw new PlaybookNotFoundError(`Failed to load playbook from ${playbookPath}: ${getErrorMessage(error)}`)
    }
  }

  public async save(playbook: Playbook, directory?: string): Promise<void> {
    const aceDirPath = this.getAceDirPath(directory)
    const playbookPath = this.getPlaybookPath(directory)

    try {
      // Create .brv/ace directory if it doesn't exist
      await mkdir(aceDirPath, {recursive: true})

      // Save all bullet content to separate files
      const bullets = playbook.getBullets()
      await Promise.all(bullets.map((bullet) => this.contentStore.save(bullet.id, bullet.content, directory)))

      // Write playbook.json (without content)
      const content = playbook.dumps(false)
      await writeFile(playbookPath, content, 'utf8')
    } catch (error) {
      throw new Error(`Failed to save playbook to ${playbookPath}: ${getErrorMessage(error)}`)
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
   * Gets the full path to the playbook.json file
   */
  private getPlaybookPath(directory?: string): string {
    return join(this.getAceDirPath(directory), FilePlaybookStore.PLAYBOOK_FILE)
  }
}
