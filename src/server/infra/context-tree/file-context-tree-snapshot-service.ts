import {readdir, readFile, stat, writeFile} from 'node:fs/promises'
import {join, relative} from 'node:path'

import type {IContextTreeSnapshotService} from '../../core/interfaces/context-tree/i-context-tree-snapshot-service.js'

import {BRV_DIR, CONTEXT_FILE_EXTENSION, CONTEXT_TREE_DIR, README_FILE, SNAPSHOT_FILE} from '../../constants.js'
import {
  ContextTreeChanges,
  ContextTreeSnapshot,
  ContextTreeSnapshotJson,
  FileState,
} from '../../core/domain/entities/context-tree-snapshot.js'
import {computeContentHash} from './hash-utils.js'
import {toUnixPath} from './path-utils.js'

export type ContextTreeSnapshotServiceConfig = {
  baseDirectory?: string
}

/**
 * File-based implementation of IContextTreeSnapshotService.
 * Tracks context tree changes using content hashing.
 */
export class FileContextTreeSnapshotService implements IContextTreeSnapshotService {
  private readonly config: ContextTreeSnapshotServiceConfig

  public constructor(config: ContextTreeSnapshotServiceConfig = {}) {
    this.config = config
  }

  public async getChanges(directory?: string): Promise<ContextTreeChanges> {
    const baseDir = directory ?? this.config.baseDirectory ?? process.cwd()
    const contextTreeDir = join(baseDir, BRV_DIR, CONTEXT_TREE_DIR)

    const snapshot = await this.loadSnapshot(contextTreeDir)
    if (!snapshot) {
      // No snapshot means everything is "new" but we return empty for clean status
      return {added: [], deleted: [], modified: []}
    }

    const currentState = await this.getCurrentState(directory)
    return snapshot.compare(currentState)
  }

  public async getCurrentState(directory?: string): Promise<Map<string, FileState>> {
    const baseDir = directory ?? this.config.baseDirectory ?? process.cwd()
    const contextTreeDir = join(baseDir, BRV_DIR, CONTEXT_TREE_DIR)

    const files = new Map<string, FileState>()

    try {
      await this.scanDirectory(contextTreeDir, contextTreeDir, files)
    } catch {
      // Directory doesn't exist or can't be read
      return files
    }

    return files
  }

  public async getSnapshotState(directory?: string): Promise<Map<string, FileState>> {
    const baseDir = directory ?? this.config.baseDirectory ?? process.cwd()
    const contextTreeDir = join(baseDir, BRV_DIR, CONTEXT_TREE_DIR)
    const snapshot = await this.loadSnapshot(contextTreeDir)
    if (!snapshot) return new Map()
    return new Map(snapshot.files)
  }

  public async hasSnapshot(directory?: string): Promise<boolean> {
    const baseDir = directory ?? this.config.baseDirectory ?? process.cwd()
    const snapshotPath = join(baseDir, BRV_DIR, CONTEXT_TREE_DIR, SNAPSHOT_FILE)

    try {
      await stat(snapshotPath)
      return true
    } catch {
      return false
    }
  }

  public async initEmptySnapshot(directory?: string): Promise<void> {
    const baseDir = directory ?? this.config.baseDirectory ?? process.cwd()
    const contextTreeDir = join(baseDir, BRV_DIR, CONTEXT_TREE_DIR)
    const snapshotPath = join(contextTreeDir, SNAPSHOT_FILE)

    const emptySnapshot = ContextTreeSnapshot.create(new Map())
    await writeFile(snapshotPath, JSON.stringify(emptySnapshot.toJson(), null, 2), 'utf8')
  }

  public async saveSnapshot(directory?: string): Promise<void> {
    const baseDir = directory ?? this.config.baseDirectory ?? process.cwd()
    const contextTreeDir = join(baseDir, BRV_DIR, CONTEXT_TREE_DIR)
    const snapshotPath = join(contextTreeDir, SNAPSHOT_FILE)

    const currentState = await this.getCurrentState(directory)
    const snapshot = ContextTreeSnapshot.create(currentState)

    await writeFile(snapshotPath, JSON.stringify(snapshot.toJson(), null, 2), 'utf8')
  }

  public async saveSnapshotFromState(state: Map<string, FileState>, directory?: string): Promise<void> {
    const baseDir = directory ?? this.config.baseDirectory ?? process.cwd()
    const contextTreeDir = join(baseDir, BRV_DIR, CONTEXT_TREE_DIR)
    const snapshotPath = join(contextTreeDir, SNAPSHOT_FILE)

    const snapshot = ContextTreeSnapshot.create(state)
    await writeFile(snapshotPath, JSON.stringify(snapshot.toJson(), null, 2), 'utf8')
  }

  /**
   * Loads snapshot from file.
   */
  private async loadSnapshot(contextTreeDir: string): Promise<ContextTreeSnapshot | null> {
    const snapshotPath = join(contextTreeDir, SNAPSHOT_FILE)

    try {
      const content = await readFile(snapshotPath, 'utf8')
      const json = JSON.parse(content) as ContextTreeSnapshotJson
      return ContextTreeSnapshot.fromJson(json) ?? null
    } catch {
      return null
    }
  }

  /**
   * Processes a single file and adds it to the files map.
   */
  private async processFile(fullPath: string, rootDir: string, files: Map<string, FileState>): Promise<void> {
    const relativePath = toUnixPath(relative(rootDir, fullPath))
    const [content, fileStat] = await Promise.all([readFile(fullPath), stat(fullPath)])

    files.set(relativePath, {
      hash: computeContentHash(content),
      size: fileStat.size,
    })
  }

  /**
   * Recursively scans directory for files, excluding snapshot file.
   */
  private async scanDirectory(currentDir: string, rootDir: string, files: Map<string, FileState>): Promise<void> {
    const entries = await readdir(currentDir, {withFileTypes: true})

    const tasks: Promise<void>[] = []

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name)

      // Skip snapshot file
      if (entry.name === SNAPSHOT_FILE) {
        continue
      }

      if (entry.isDirectory()) {
        tasks.push(this.scanDirectory(fullPath, rootDir, files))
      } else if (entry.isFile() && entry.name.endsWith(CONTEXT_FILE_EXTENSION)) {
        // Only ignore README.md at root level, track it in subdirectories
        const isRoot = currentDir === rootDir
        const isReadmeAtRoot = entry.name === README_FILE && isRoot
        if (!isReadmeAtRoot) {
          tasks.push(this.processFile(fullPath, rootDir, files))
        }
      }
    }

    await Promise.all(tasks)
  }
}
