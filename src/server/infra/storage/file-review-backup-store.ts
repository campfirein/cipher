import {mkdir, readdir, readFile, rm, stat, writeFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'

import type {IReviewBackupStore} from '../../core/interfaces/storage/i-review-backup-store.js'

import {REVIEW_BACKUPS_DIR} from '../../constants.js'

/**
 * File-based implementation of IReviewBackupStore.
 *
 * Stores pre-curate file content in {projectBrvDir}/review-backups/{relativePath}.
 * The directory mirrors the context tree structure.
 *
 * First-write-wins: once a backup exists for a path, subsequent save() calls are no-ops.
 * This ensures the backup always reflects the state at the time of the last push (snapshot version).
 */
export class FileReviewBackupStore implements IReviewBackupStore {
  private readonly backupDir: string

  constructor(brvDir: string) {
    this.backupDir = join(brvDir, REVIEW_BACKUPS_DIR)
  }

  async clear(): Promise<void> {
    try {
      await rm(this.backupDir, {force: true, recursive: true})
    } catch {
      // Directory may not exist — that's fine
    }
  }

  async delete(relativePath: string): Promise<void> {
    try {
      await rm(join(this.backupDir, relativePath))
    } catch {
      // File may not exist — that's fine
    }
  }

  async has(relativePath: string): Promise<boolean> {
    try {
      await stat(join(this.backupDir, relativePath))
      return true
    } catch {
      return false
    }
  }

  /**
   * List all backed-up file paths (relative to backup dir).
   * Useful for the review UI to enumerate all files with backups.
   */
  async list(): Promise<string[]> {
    const paths: string[] = []

    const scan = async (dir: string, prefix: string): Promise<void> => {
      let entries
      try {
        entries = await readdir(dir, {withFileTypes: true})
      } catch {
        return
      }

      const subdirTasks: Promise<void>[] = []
      for (const entry of entries) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
          subdirTasks.push(scan(join(dir, entry.name), relativePath))
        } else if (entry.isFile()) {
          paths.push(relativePath)
        }
      }

      await Promise.all(subdirTasks)
    }

    await scan(this.backupDir, '')
    return paths
  }

  async read(relativePath: string): Promise<null | string> {
    try {
      return await readFile(join(this.backupDir, relativePath), 'utf8')
    } catch {
      return null
    }
  }

  async save(relativePath: string, content: string): Promise<void> {
    const backupPath = join(this.backupDir, relativePath)

    // First-write-wins: skip if backup already exists
    if (await this.has(relativePath)) return

    await mkdir(dirname(backupPath), {recursive: true})
    await writeFile(backupPath, content, 'utf8')
  }
}
