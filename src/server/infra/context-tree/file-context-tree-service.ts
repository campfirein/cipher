import {access, mkdir, rm} from 'node:fs/promises'
import {join} from 'node:path'

import type {IContextTreeService} from '../../core/interfaces/context-tree/i-context-tree-service.js'

import {BRV_DIR, CONTEXT_TREE_DIR} from '../../constants.js'

export type ContextTreeServiceConfig = {
  baseDirectory?: string
}

/**
 * File-based implementation of IContextTreeService.
 * Provides operations for managing the context tree structure.
 */
export class FileContextTreeService implements IContextTreeService {
  private readonly config: ContextTreeServiceConfig

  public constructor(config: ContextTreeServiceConfig = {}) {
    this.config = config
  }

  public async delete(directory?: string): Promise<void> {
    const baseDir = directory ?? this.config.baseDirectory ?? process.cwd()
    const contextTreeDir = join(baseDir, BRV_DIR, CONTEXT_TREE_DIR)
    await rm(contextTreeDir, {force: true, recursive: true})
  }

  public async exists(directory?: string): Promise<boolean> {
    const baseDir = directory ?? this.config.baseDirectory ?? process.cwd()
    const contextTreeDir = join(baseDir, BRV_DIR, CONTEXT_TREE_DIR)

    try {
      // Check if context tree directory exists
      await access(contextTreeDir)
      return true
    } catch {
      return false
    }
  }

  public async initialize(directory?: string): Promise<string> {
    const baseDir = directory ?? this.config.baseDirectory ?? process.cwd()
    const brvDir = join(baseDir, BRV_DIR)
    const contextTreeDir = join(brvDir, CONTEXT_TREE_DIR)

    // Create .brv/context-tree/ directory only
    // Domains are created dynamically by the agent based on curated content
    await mkdir(contextTreeDir, {recursive: true})

    return contextTreeDir
  }

  public resolvePath(directory: string): string {
    return join(directory, BRV_DIR, CONTEXT_TREE_DIR)
  }
}
