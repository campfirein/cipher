/**
 * Factory for creating and initializing the query harness service.
 *
 * Handles:
 * - Creating the FileHarnessTreeStore with the project's storage path
 * - Creating three HarnessEngine instances (decompose, boost, rerank)
 * - Returning a ready-to-use QueryHarnessService
 *
 * Follows create-curation-harness.ts pattern.
 */

import {FileHarnessTreeStore} from '../file-harness-tree-store.js'
import {HarnessEngine} from '../harness-engine.js'
import {QueryHarnessService} from './query-harness-service.js'

/**
 * Create and initialize a QueryHarnessService.
 *
 * Returns null if initialization fails (fail-open).
 *
 * @param storagePath - Per-project data directory path
 * @returns Ready QueryHarnessService, or null on failure.
 *   Call service.setContentGenerator() after agent starts to enable refinement.
 */
export async function createQueryHarness(
  storagePath: string,
): Promise<null | QueryHarnessService> {
  try {
    const treeStore = new FileHarnessTreeStore({getBaseDir: () => storagePath})

    const decomposeEngine = new HarnessEngine({
      config: {domain: 'query/decompose', refinementCooldown: 5},
      treeStore,
    })

    const boostEngine = new HarnessEngine({
      config: {domain: 'query/boost', refinementCooldown: 5},
      treeStore,
    })

    const rerankEngine = new HarnessEngine({
      config: {domain: 'query/rerank', refinementCooldown: 5},
      treeStore,
    })

    return new QueryHarnessService({
      boostEngine,
      decomposeEngine,
      rerankEngine,
      treeStore,
    })
  } catch {
    // Fail-open: harness init errors never block the agent process

    return null
  }
}
