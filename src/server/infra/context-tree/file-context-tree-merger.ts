import {copyFile, mkdir, opendir, readFile, rename, rm, stat, unlink, writeFile} from 'node:fs/promises'
import {dirname, extname, join} from 'node:path'

import type {FileState} from '../../core/domain/entities/context-tree-snapshot.js'
import type {IContextTreeMerger, MergeParams, MergeResult} from '../../core/interfaces/context-tree/i-context-tree-merger.js'
import type {IContextTreeSnapshotService} from '../../core/interfaces/context-tree/i-context-tree-snapshot-service.js'

import {BRV_DIR, CONTEXT_TREE_BACKUP_DIR, CONTEXT_TREE_CONFLICT_DIR, CONTEXT_TREE_DIR} from '../../constants.js'
import {computeContentHash} from './hash-utils.js'
import {toUnixPath} from './path-utils.js'

export type FileContextTreeMergerDependencies = {
  snapshotService: IContextTreeSnapshotService
}

/**
 * File-based implementation of IContextTreeMerger.
 *
 * Backup semantics (.brv/context-tree-backup/):
 *   Created at the start of every merge as a full clone of the local context tree.
 *   Used exclusively as a safety net for automatic rollback on failure.
 *   Always deleted after a successful merge.
 *
 * Conflict directory semantics (.brv/context-tree-conflict/):
 *   Created during a merge only when true conflicts occur (both sides changed the same file).
 *   Contains only the original local versions of conflicted files, mirroring their paths.
 *   The merged context tree retains the remote version at the original path and saves the
 *   local version at a _N.md-suffixed path for review.
 *   Cleared automatically at the start of the next merge.
 *
 * Merge rules:
 *   - Local wins when remote has NOT changed the file (remote hash == snapshot hash).
 *   - Remote wins (overwrite) when remote has changed a clean local file.
 *   - Conflict (both changed): local saved as _N.md + original copied to conflict dir,
 *     remote written to original path.
 *
 * On failure:
 *   The context tree is automatically restored from the backup, and any partial conflict
 *   directory is removed. The backup is deleted after restoration. The caller (space-handler)
 *   is responsible for rolling back space/team config.
 */
export class FileContextTreeMerger implements IContextTreeMerger {
  private static readonly MAX_RENAME_ATTEMPTS = 100
  private readonly snapshotService: IContextTreeSnapshotService

  public constructor(deps: FileContextTreeMergerDependencies) {
    this.snapshotService = deps.snapshotService
  }

  public async merge(params: MergeParams): Promise<MergeResult> {
    const {directory, files, localChanges, preserveLocalFiles = false} = params
    const contextTreeDir = join(directory, BRV_DIR, CONTEXT_TREE_DIR)
    const backupDir = join(directory, BRV_DIR, CONTEXT_TREE_BACKUP_DIR)
    const conflictDir = join(directory, BRV_DIR, CONTEXT_TREE_CONFLICT_DIR)

    // Capture pre-merge disk state and saved snapshot state for comparison
    const localState = await this.snapshotService.getCurrentState(directory)
    const snapshotState = await this.snapshotService.getSnapshotState(directory)

    // Only added/modified files can conflict — deleted files are absent from disk so they
    // cannot be read during conflict handling. Locally-deleted + remote-changed falls through
    // to the "file not on disk" branch in runMerge(), where remote wins by re-creating the file.
    const conflictPaths = new Set([...localChanges.added, ...localChanges.modified])

    const remoteFilesMap = this.buildRemoteFilesMap(files)

    // Clear any leftover backup or conflict folder from a previous merge.
    await rm(backupDir, {force: true, recursive: true})
    await rm(conflictDir, {force: true, recursive: true})

    // Backup local context tree as a safety net for rollback on failure.
    try {
      await this.copyDir(contextTreeDir, backupDir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      // Context tree dir does not exist — nothing to back up, continue
    }

    try {
      const result = await this.runMerge({
        conflictDir,
        conflictPaths,
        contextTreeDir,
        localState,
        preserveLocalFiles,
        remoteFilesMap,
        snapshotState,
      })

      // Save snapshot atomically before deleting backup.
      // If this fails, the catch block will restore the context tree from the backup.
      await this.snapshotService.saveSnapshotFromState(result.remoteFileStates, directory)

      // Snapshot saved — backup is no longer needed.
      await rm(backupDir, {force: true, recursive: true})

      if (result.conflicted.length > 0) {
        return {...result, conflictDir}
      }

      return result
    } catch (error) {
      // Failure: automatically restore context tree from backup.
      await rm(contextTreeDir, {force: true, recursive: true})
      try {
        await rename(backupDir, contextTreeDir)
      } catch {
        // Backup does not exist (context tree was empty before merge) — context tree is cleanly absent.
      }

      // Remove any partial conflict directory created before the failure.
      await rm(conflictDir, {force: true, recursive: true}).catch(() => {})

      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Merge failed: ${message}. Context tree has been restored to its original state.`)
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
    conflictDir: string
    conflictPaths: Set<string>
    contextTreeDir: string
    localState: Map<string, FileState>
    preserveLocalFiles: boolean
    remoteFilesMap: Map<string, {decodedContent: string}>
    snapshotState: Map<string, FileState>
  }): Promise<Omit<MergeResult, 'conflictDir'>> {
    const {conflictDir, conflictPaths, contextTreeDir, localState, preserveLocalFiles, remoteFilesMap, snapshotState} =
      params

    const added: string[] = []
    const edited: string[] = []
    const deleted: string[] = []
    const conflicted: string[] = []
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
        // Both sides changed — check if content is actually different before treating as conflict.
        const localContent = await readFile(targetPath, 'utf8')

        if (localContent === file.decodedContent) {
          // Both sides converged on the same content — no real conflict, treat as edited.
          edited.push(normalPath)
        } else {
          // True conflict: preserve original local in conflict dir, rename local to _N.md,
          // write remote to original path.

          // Copy original to conflict dir for review
          const conflictTargetPath = join(conflictDir, normalPath)
          await mkdir(dirname(conflictTargetPath), {recursive: true})
          await writeFile(conflictTargetPath, localContent, 'utf8')

          // Save local version at _N.md
          const newRelPath = await this.findAvailableName(contextTreeDir, normalPath)
          const newTargetPath = join(contextTreeDir, newRelPath)
          await mkdir(dirname(newTargetPath), {recursive: true})
          await writeFile(newTargetPath, localContent, 'utf8')

          // Write remote to original path
          await mkdir(dirname(targetPath), {recursive: true})
          await writeFile(targetPath, file.decodedContent, 'utf8')

          added.push(newRelPath)
          conflicted.push(normalPath)
        }
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

    // Delete clean local files that are not in remote.
    // When preserveLocalFiles is true (first-time space connect), skip this step: the local
    // context tree has no shared history with the target space, so "file not in remote" means
    // "remote has never seen it", not "remote deleted it". Preserved files will appear as
    // "added" on the next getChanges() call, prompting the user to push them to the new space.
    if (!preserveLocalFiles) {
      for (const localPath of localState.keys()) {
        const isLocallyChanged = conflictPaths.has(localPath)
        const isInRemote = remoteFilesMap.has(localPath)

        if (!isLocallyChanged && !isInRemote) {
          await unlink(join(contextTreeDir, localPath))
          deleted.push(localPath)
        }
      }
    }
    /* eslint-enable no-await-in-loop */

    return {added, conflicted, deleted, edited, remoteFileStates}
  }
}
