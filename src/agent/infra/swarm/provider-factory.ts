import type {IMemoryProvider} from '../../core/interfaces/i-memory-provider.js'
import type {SwarmConfig} from './config/swarm-config-schema.js'

import {ByteRoverAdapter, type SearchService} from './adapters/byterover-adapter.js'
import {GBrainAdapter} from './adapters/gbrain-adapter.js'
import {LocalMarkdownAdapter} from './adapters/local-markdown-adapter.js'
import {ObsidianAdapter} from './adapters/obsidian-adapter.js'

/**
 * Options for building providers from config.
 */
export interface ProviderFactoryOptions {
  /**
   * Search service for ByteRover adapter.
   * In agent mode, this is the real SearchKnowledgeService.
   * In CLI mode, this can be omitted (a no-op stub is used).
   */
  searchService?: SearchService
}

/**
 * No-op search service for CLI-only mode when no real search service is available.
 * ByteRover adapter will return empty results, but other providers (Obsidian, local-markdown)
 * will still work with their own indexes.
 */
const STUB_SEARCH_SERVICE: SearchService = {
  async search() {
    return {results: [], totalFound: 0}
  },
}

/**
 * Build IMemoryProvider instances from a validated SwarmConfig.
 *
 * Used by both the CLI command and the agent runtime to avoid duplicating
 * adapter construction logic.
 */
export function buildProvidersFromConfig(
  config: SwarmConfig,
  options?: ProviderFactoryOptions,
): IMemoryProvider[] {
  const providers: IMemoryProvider[] = []

  // ByteRover — always first, always the "home" provider
  if (config.providers.byterover.enabled) {
    const searchService = options?.searchService ?? STUB_SEARCH_SERVICE
    providers.push(new ByteRoverAdapter(searchService))
  }

  // Obsidian
  if (config.providers.obsidian?.enabled) {
    providers.push(new ObsidianAdapter(config.providers.obsidian.vaultPath, {
      ignorePatterns: config.providers.obsidian.ignorePatterns,
      watchForChanges: config.providers.obsidian.watchForChanges,
    }))
  }

  // Local Markdown — one adapter per folder, with deduplication of names
  if (config.providers.localMarkdown?.enabled) {
    const nameCount = new Map<string, number>()
    for (const folder of config.providers.localMarkdown.folders) {
      // Deduplicate: if two folders share the same name, suffix with index
      const count = nameCount.get(folder.name) ?? 0
      nameCount.set(folder.name, count + 1)
      const uniqueName = count === 0 ? folder.name : `${folder.name}-${count}`

      providers.push(new LocalMarkdownAdapter(folder.path, uniqueName, {
        followWikilinks: folder.followWikilinks,
        readOnly: folder.readOnly,
        watchForChanges: config.providers.localMarkdown.watchForChanges,
      }))
    }
  }

  // GBrain
  if (config.providers.gbrain?.enabled) {
    providers.push(new GBrainAdapter({
      repoPath: config.providers.gbrain.repoPath,
      searchMode: config.providers.gbrain.searchMode,
    }))
  }

  // Cloud providers (honcho, hindsight) are temporarily disabled — adapters coming in Phase 3.

  return providers
}
