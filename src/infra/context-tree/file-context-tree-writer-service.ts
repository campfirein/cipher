import {mkdir, unlink, writeFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'

import type {IContextTreeSnapshotService} from '../../core/interfaces/i-context-tree-snapshot-service.js'
import type {
  IContextTreeWriterService,
  SyncParams,
  SyncResult,
} from '../../core/interfaces/i-context-tree-writer-service.js'

import {BRV_DIR, CONTEXT_TREE_DIR} from '../../constants.js'

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
    for (const [relativePath, file] of remoteFiles) {
      const fullPath = join(contextTreeDir, relativePath)

      // Create parent directories if needed
      // eslint-disable-next-line no-await-in-loop
      await mkdir(dirname(fullPath), {recursive: true})

      // Write decoded content
      // eslint-disable-next-line no-await-in-loop
      await writeFile(fullPath, file.decodeContent(), 'utf8')

      if (localState.has(relativePath)) {
        edited.push(relativePath)
      } else {
        added.push(relativePath)
      }
    }

    // Process deletions: local files not in remote
    for (const localPath of localState.keys()) {
      if (!remoteFiles.has(localPath)) {
        const fullPath = join(contextTreeDir, localPath)
        // eslint-disable-next-line no-await-in-loop
        await unlink(fullPath)
        deleted.push(localPath)
      }
    }

    return {added, deleted, edited}
  }

  /**
   * Normalizes a file path by removing leading slashes.
   */
  private normalizePath(path: string): string {
    return path.replace(/^\/+/, '')
  }
}
