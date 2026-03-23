import {copyFile, mkdir, opendir, rename, rm} from 'node:fs/promises'
import {join} from 'node:path'

type TransactionState = 'active' | 'committed' | 'idle' | 'rolledBack'

export interface ContextTreeTransactionDependencies {
  backupDir?: string
  contextTreeDir: string
}

/**
 * Provides begin/commit/rollback semantics for context tree modifications.
 *
 * Uses a backup/restore pattern: begin() copies the tree to a backup directory,
 * commit() deletes the backup, and rollback() restores from backup.
 *
 * State machine: idle → active → committed | rolledBack
 */
export class ContextTreeTransaction {
  private readonly backupDir: string
  private readonly contextTreeDir: string
  private state: TransactionState = 'idle'

  public constructor(deps: ContextTreeTransactionDependencies) {
    this.contextTreeDir = deps.contextTreeDir
    this.backupDir = deps.backupDir ?? `${deps.contextTreeDir}-reorg-backup`
  }

  /**
   * Begin the transaction by creating a full backup of the context tree.
   * @throws Error if the transaction is not in idle state
   */
  public async begin(): Promise<void> {
    if (this.state !== 'idle') {
      throw new Error(`Cannot begin transaction: current state is '${this.state}', expected 'idle'`)
    }

    await rm(this.backupDir, {force: true, recursive: true})
    await copyDir(this.contextTreeDir, this.backupDir)
    this.state = 'active'
  }

  /**
   * Commit the transaction by removing the backup directory.
   * @throws Error if the transaction is not in active state
   */
  public async commit(): Promise<void> {
    if (this.state !== 'active') {
      throw new Error(`Cannot commit transaction: current state is '${this.state}', expected 'active'`)
    }

    await rm(this.backupDir, {force: true, recursive: true})
    this.state = 'committed'
  }

  /**
   * Rollback the transaction by restoring the context tree from backup.
   * @throws Error if the transaction is not in active state
   */
  public async rollback(): Promise<void> {
    if (this.state !== 'active') {
      throw new Error(`Cannot rollback transaction: current state is '${this.state}', expected 'active'`)
    }

    await rm(this.contextTreeDir, {force: true, recursive: true})
    await rename(this.backupDir, this.contextTreeDir)
    this.state = 'rolledBack'
  }
}

/**
 * Recursively copies a directory tree from src to dest.
 */
async function copyDir(src: string, dest: string): Promise<void> {
  await mkdir(dest, {recursive: true})
  const dir = await opendir(src)
  for await (const entry of dir) {
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)
    await (entry.isDirectory() ? copyDir(srcPath, destPath) : copyFile(srcPath, destPath))
  }
}
