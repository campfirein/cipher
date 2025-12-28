/* eslint-disable no-await-in-loop */
import {mkdir, readFile, unlink, writeFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'

import type {IContextTreeSnapshotService} from '../../core/interfaces/i-context-tree-snapshot-service.js'
import type {
  IContextTreeWriterService,
  SyncParams,
  SyncResult,
} from '../../core/interfaces/i-context-tree-writer-service.js'

import {BRV_DIR, CONTEXT_TREE_DIR} from '../../constants.js'
import {toUnixPath} from './path-utils.js'

export type ContextTreeWriterServiceConfig = {
  baseDirectory?: string
}

export type ContextTreeWriterServiceDependencies = {
  snapshotService: IContextTreeSnapshotService
}

/**
 * File-based implementation of IContextTreeWriterService.
 * Synchronizes context tree files based on CoGit snapshot data.
 */
export class FileContextTreeWriterService implements IContextTreeWriterService {
  private readonly config: ContextTreeWriterServiceConfig
  private readonly snapshotService: IContextTreeSnapshotService

  public constructor(dependencies: ContextTreeWriterServiceDependencies, config: ContextTreeWriterServiceConfig = {}) {
    this.snapshotService = dependencies.snapshotService
    this.config = config
  }

  public async sync(params: SyncParams): Promise<SyncResult> {
    const baseDir = params.directory ?? this.config.baseDirectory ?? process.cwd()
    const contextTreeDir = join(baseDir, BRV_DIR, CONTEXT_TREE_DIR)

    // Get current local state
    const localState = await this.snapshotService.getCurrentState(params.directory)

    // Build map of remote files (normalize paths - remove leading /)
    const remoteFiles = new Map(params.files.map((file) => [this.normalizePath(file.path), file]))

    const added: string[] = []
    const edited: string[] = []
    const deleted: string[] = []

    // Process remote files: add or edit
    for (const [remoteRelativePath, remoteFile] of remoteFiles) {
      const fullPath = join(contextTreeDir, remoteRelativePath)
      const decodedContent = remoteFile.decodeContent()

      if (localState.has(remoteRelativePath)) {
        // File exists locally - check if content differs
        const localContent = await readFile(fullPath, 'utf8')
        if (localContent !== decodedContent) {
          await writeFile(fullPath, decodedContent, 'utf8')
          edited.push(remoteRelativePath)
        }
      } else {
        // New file - create parent directories and write
        await mkdir(dirname(fullPath), {recursive: true})
        await writeFile(fullPath, decodedContent, 'utf8')
        added.push(remoteRelativePath)
      }
    }

    // Process deletions: local files not in remote
    for (const localPath of localState.keys()) {
      if (!remoteFiles.has(localPath)) {
        const fullPath = join(contextTreeDir, localPath)
        await unlink(fullPath)
        deleted.push(localPath)
      }
    }

    return {added, deleted, edited}
  }

  /**
   * Normalizes a file path by converting backslashes to forward slashes
   * and removing leading slashes.
   * Ensures cross-platform compatibility and handles legacy API responses
   * that may include leading slashes or Windows-style backslashes.
   */
  private normalizePath(path: string): string {
    return toUnixPath(path).replace(/^\/+/, '')
  }
}
