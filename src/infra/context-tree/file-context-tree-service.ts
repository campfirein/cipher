import {access, mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import type {IContextTreeService} from '../../core/interfaces/i-context-tree-service.js'

import {CONTEXT_TREE_DOMAINS} from '../../config/context-tree-domains.js'
import {BRV_DIR, CONTEXT_FILE, CONTEXT_TREE_DIR} from '../../constants.js'

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

    // Create .brv/context-tree/ directory
    await mkdir(contextTreeDir, {recursive: true})

    // Create domain folders and context.md files in parallel
    await Promise.all(
      CONTEXT_TREE_DOMAINS.map(async (domain) => {
        const domainPath = join(contextTreeDir, domain.name)
        await mkdir(domainPath, {recursive: true})

        // Write context.md with domain description
        const contextMdPath = join(domainPath, CONTEXT_FILE)
        const contextContent = `# ${domain.name.replaceAll('_', ' ').replaceAll(/\b\w/g, (c) => c.toUpperCase())}\n\n${
          domain.description
        }\n`
        await writeFile(contextMdPath, contextContent, 'utf8')
      }),
    )

    // Note: index.json is no longer created as it's not actively used
    // Context tree uses filesystem-based discovery instead

    return contextTreeDir
  }
}
