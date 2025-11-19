import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import type {ContextNode} from '../../core/domain/entities/context-tree-index.js'
import type {IContextTreeService} from '../../core/interfaces/i-context-tree-service.js'

import {CONTEXT_TREE_DOMAINS} from '../../config/context-tree-domains.js'
import {BRV_DIR, CONTEXT_FILE, CONTEXT_TREE_DIR, CONTEXT_TREE_INDEX_FILE} from '../../constants.js'
import {ContextTreeIndex} from '../../core/domain/entities/context-tree-index.js'

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
    const indexPath = join(contextTreeDir, CONTEXT_TREE_INDEX_FILE)

    try {
      await readFile(indexPath, 'utf8')
      return true
    } catch {
      return false
    }
  }

  public async getIndex(directory?: string): Promise<ContextTreeIndex> {
    const baseDir = directory ?? this.config.baseDirectory ?? process.cwd()
    const contextTreeDir = join(baseDir, BRV_DIR, CONTEXT_TREE_DIR)
    const indexPath = join(contextTreeDir, CONTEXT_TREE_INDEX_FILE)

    try {
      const content = await readFile(indexPath, 'utf8')
      const json = JSON.parse(content) as Record<string, unknown>
      return ContextTreeIndex.fromJson(json)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error('Context tree index not found. Run `brv init` first.')
      }

      throw new Error(`Failed to read context tree index: ${(error as Error).message}`)
    }
  }

  public async initialize(directory?: string): Promise<string> {
    const baseDir = directory ?? this.config.baseDirectory ?? process.cwd()
    const brvDir = join(baseDir, BRV_DIR)
    const contextTreeDir = join(brvDir, CONTEXT_TREE_DIR)

    // Create .brv/context-tree/ directory
    await mkdir(contextTreeDir, {recursive: true})

    // Build the context tree structure
    const domains: ContextNode[] = []

    // Create domain folders and context.md files in parallel
    await Promise.all(
      CONTEXT_TREE_DOMAINS.map(async (domain) => {
        const domainPath = join(contextTreeDir, domain.name)
        await mkdir(domainPath, {recursive: true})

        // Write context.md with domain description
        const contextMdPath = join(domainPath, CONTEXT_FILE)
        const contextContent = `# ${domain.name.replaceAll('_', ' ').replaceAll(/\b\w/g, (c) => c.toUpperCase())}\n\n${domain.description}\n`
        await writeFile(contextMdPath, contextContent, 'utf8')

        // Add domain node to the index (we don't include context.md in the tree structure)
        domains.push({
          name: domain.name,
          path: domain.name,
          type: 'folder',
        })
      }),
    )

    // Create and save the index
    const index = new ContextTreeIndex(domains)
    const indexPath = join(contextTreeDir, CONTEXT_TREE_INDEX_FILE)
    await writeFile(indexPath, JSON.stringify(index.toJson(), null, 2), 'utf8')

    return contextTreeDir
  }
}
