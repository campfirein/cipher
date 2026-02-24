import {copyFile, mkdir, opendir, readFile, rm, stat, unlink, writeFile} from 'node:fs/promises'
import {dirname, extname, join} from 'node:path'

import type {FileState} from '../../core/domain/entities/context-tree-snapshot.js'
import type {IContextTreeMerger, MergeParams, MergeResult} from '../../core/interfaces/context-tree/i-context-tree-merger.js'
import type {IContextTreeSnapshotService} from '../../core/interfaces/context-tree/i-context-tree-snapshot-service.js'

import {BRV_DIR, CONTEXT_TREE_BACKUP_DIR, CONTEXT_TREE_DIR} from '../../constants.js'
import {computeContentHash} from './hash-utils.js'
import {toUnixPath} from './path-utils.js'

export type FileContextTreeMergerDependencies = {
  snapshotService: IContextTreeSnapshotService
}

/**
 * File-based implementation of IContextTreeMerger.
 *
 * Backs up the local context tree before any destructive operation.
 * Merges remote CoGit snapshot files into the local context tree using the rule:
 *   - Local wins when remote has NOT changed the file (remote hash == snapshot hash).
 *   - Remote wins (with _N.md renaming for safety) when remote HAS changed the file.
 *
 * Backup at .brv/context-tree-backup/ is returned in MergeResult.backupDir — the caller
 * must delete it after all post-merge operations (e.g. saveSnapshotFromState) complete
 * successfully. On failure, the backup is preserved so the user can recover manually.
 */
export class FileContextTreeMerger implements IContextTreeMerger {
  private static readonly MAX_RENAME_ATTEMPTS = 100
  private readonly snapshotService: IContextTreeSnapshotService

  public constructor(deps: FileContextTreeMergerDependencies) {
    this.snapshotService = deps.snapshotService
  }

  public async merge(params: MergeParams): Promise<MergeResult> {
    const {directory, files, localChanges} = params
    const contextTreeDir = join(directory, BRV_DIR, CONTEXT_TREE_DIR)
    const backupDir = join(directory, BRV_DIR, CONTEXT_TREE_BACKUP_DIR)

    // Capture pre-merge disk state and saved snapshot state for comparison
    const localState = await this.snapshotService.getCurrentState(directory)
    const snapshotState = await this.snapshotService.getSnapshotState(directory)

    const conflictPaths = new Set([...localChanges.added, ...localChanges.modified])

    const remoteFilesMap = this.buildRemoteFilesMap(files)

    // Backup local context tree before any destructive operation.
    // Left in place on failure so the user can recover manually.
    await rm(backupDir, {force: true, recursive: true})
    try {
      await this.copyDir(contextTreeDir, backupDir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      // Context tree dir does not exist — nothing to back up, continue
    }

    try {
      const result = await this.runMerge({conflictPaths, contextTreeDir, localState, remoteFilesMap, snapshotState})
      // Backup is returned to the caller — it must be deleted after all post-merge operations succeed.
      return {...result, backupDir}
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Merge failed: ${message}. Your original context tree is backed up at: ${backupDir}`)
    }
  }

  /**
   * Builds a map of remote files with normalized paths and decoded content.
   */
  private buildRemoteFilesMap(files: MergeParams['files']): Map<string, {decodedContent: string}> {
    const result = new Map<string, {decodedContent: string}>()

    for (const file of files) {
      const normalPath = toUnixPath(file.path).replace(/^\/+/, '')
      result.set(normalPath, {decodedContent: file.decodeContent()})
    }

    return result
  }

  /**
   * Recursively copies a directory tree from src to dest.
   */
  private async copyDir(src: string, dest: string): Promise<void> {
    await mkdir(dest, {recursive: true})
    const dir = await opendir(src)
    for await (const entry of dir) {
      const srcPath = join(src, entry.name)
      const destPath = join(dest, entry.name)
      await (entry.isDirectory() ? this.copyDir(srcPath, destPath) : copyFile(srcPath, destPath))
    }
  }

  /**
   * Finds the first available filename by inserting _N before the extension.
   * e.g. "path/to/file.md" → "path/to/file_1.md", "path/to/file_2.md", …
   */
  private async findAvailableName(contextTreeDir: string, relativePath: string): Promise<string> {
    const ext = extname(relativePath) // '.md'
    const withoutExt = relativePath.slice(0, -ext.length) // 'path/to/file'

    for (let n = 1; n <= FileContextTreeMerger.MAX_RENAME_ATTEMPTS; n++) {
      const candidate = `${withoutExt}_${n}${ext}`
      const fullPath = join(contextTreeDir, candidate)

      try {
        // eslint-disable-next-line no-await-in-loop
        await stat(fullPath)
        // File exists — try next number
      } catch {
        return candidate
      }
    }

    throw new Error(
      `Cannot find available name for ${relativePath} after ${FileContextTreeMerger.MAX_RENAME_ATTEMPTS} attempts`,
    )
  }

  private async runMerge(params: {
    conflictPaths: Set<string>
    contextTreeDir: string
    localState: Map<string, FileState>
    remoteFilesMap: Map<string, {decodedContent: string}>
    snapshotState: Map<string, FileState>
  }): Promise<Omit<MergeResult, 'backupDir'>> {
    const {conflictPaths, contextTreeDir, localState, remoteFilesMap, snapshotState} = params

    const added: string[] = []
    const edited: string[] = []
    const deleted: string[] = []
    const remoteFileStates: Map<string, FileState> = new Map()

    /* eslint-disable no-await-in-loop */
    for (const [normalPath, file] of remoteFilesMap) {
      const targetPath = join(contextTreeDir, normalPath)
      const remoteHash = computeContentHash(file.decodedContent)
      const snapshotHash = snapshotState.get(normalPath)?.hash

      remoteFileStates.set(normalPath, {
        hash: remoteHash,
        size: Buffer.byteLength(file.decodedContent, 'utf8'),
      })

      if (remoteHash === snapshotHash) {
        // Remote has NOT changed this file — local wins, skip regardless of local state
        continue
      }

      // Remote has changed this file (or it is new to remote).
      if (conflictPaths.has(normalPath)) {
        // Both sides changed — rename local file to _N.md, write remote to original path
        const newRelPath = await this.findAvailableName(contextTreeDir, normalPath)
        const newTargetPath = join(contextTreeDir, newRelPath)

        const localContent = await readFile(targetPath, 'utf8')
        await mkdir(dirname(newTargetPath), {recursive: true})
        await writeFile(newTargetPath, localContent, 'utf8')

        await mkdir(dirname(targetPath), {recursive: true})
        await writeFile(targetPath, file.decodedContent, 'utf8')

        added.push(newRelPath)
      } else if (localState.has(normalPath)) {
        // File exists locally and is clean — overwrite with remote
        await writeFile(targetPath, file.decodedContent, 'utf8')
        edited.push(normalPath)
      } else {
        // File not on disk (new from remote, or locally deleted with remote having newer version) — create it
        await mkdir(dirname(targetPath), {recursive: true})
        await writeFile(targetPath, file.decodedContent, 'utf8')
        added.push(normalPath)
      }
    }

    // Delete clean local files that are not in remote (remote deleted them)
    for (const localPath of localState.keys()) {
      const isLocallyChanged = conflictPaths.has(localPath)
      const isInRemote = remoteFilesMap.has(localPath)

      if (!isLocallyChanged && !isInRemote) {
        await unlink(join(contextTreeDir, localPath))
        deleted.push(localPath)
      }
    }
    /* eslint-enable no-await-in-loop */

    return {added, deleted, edited, remoteFileStates}
  }
}
