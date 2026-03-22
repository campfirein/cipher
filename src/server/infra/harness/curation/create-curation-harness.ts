/**
 * Factory for creating and initializing the curation harness service.
 *
 * Handles:
 * - Creating the FileHarnessTreeStore with the project's storage path
 * - Creating the HarnessEngine with appropriate config
 * - Seeding the initial root template if the tree is empty
 * - Returning a ready-to-use CurationHarnessService
 */

import {randomUUID} from 'node:crypto'

import type {HarnessNode} from '../../../core/interfaces/harness/i-harness-tree-store.js'

import {FileHarnessTreeStore} from '../file-harness-tree-store.js'
import {HarnessEngine} from '../harness-engine.js'
import {DEFAULT_ALPHA, DEFAULT_BETA} from '../thompson-sampler.js'
import {CurationHarnessService} from './curation-harness-service.js'

/** Default root template: general-purpose curation strategy */
const DEFAULT_ROOT_TEMPLATE = `domainRouting:
  - keywords: [api, endpoint, rest, graphql, http]
    domain: architecture/api
  - keywords: [auth, login, jwt, oauth, token, session]
    domain: security/authentication
  - keywords: [deploy, ci, cd, pipeline, docker, kubernetes]
    domain: infrastructure/deployment
  - keywords: [test, testing, jest, mocha, cypress]
    domain: engineering/testing
  - keywords: [database, sql, postgres, mongo, redis]
    domain: infrastructure/data
operationRules:
  - condition: "existing entry found at target path"
    operation: UPDATE
  - condition: "no existing entry, single coherent concept"
    operation: ADD
  - condition: "overlapping content with existing entry"
    operation: UPSERT
factPatterns:
  - regex: "we use (\\\\w+) for"
    category: project
  - regex: "team (\\\\w+) owns"
    category: ownership
  - regex: "(\\\\w+) is responsible for"
    category: responsibility`

/**
 * Create and initialize a CurationHarnessService.
 *
 * Seeds the initial root template if the tree is empty.
 * Returns null if initialization fails (fail-open).
 *
 * @param storagePath - Per-project data directory path
 * @returns Ready CurationHarnessService, or null on failure.
 *   Call service.setContentGenerator() after agent starts to enable refinement.
 */
export async function createCurationHarness(
  storagePath: string,
): Promise<CurationHarnessService | null> {
  try {
    const treeStore = new FileHarnessTreeStore({getBaseDir: () => storagePath})
    const engine = new HarnessEngine({
      config: {domain: 'curation', refinementCooldown: 5},
      // contentGenerator is set later via service.setContentGenerator() after agent starts
      treeStore,
    })

    // Seed root node if tree is empty
    const existingRoot = await treeStore.getRootNode('curation')
    if (!existingRoot) {
      const rootNode: HarnessNode = {
        alpha: DEFAULT_ALPHA,
        beta: DEFAULT_BETA,
        childIds: [],
        createdAt: Date.now(),
        heuristic: DEFAULT_ALPHA / (DEFAULT_ALPHA + DEFAULT_BETA),
        id: randomUUID(),
        metadata: {seeded: true},
        parentId: null,
        templateContent: DEFAULT_ROOT_TEMPLATE,
        visitCount: 0,
      }

      await treeStore.saveNode('curation', rootNode)
    }

    return new CurationHarnessService(engine)
  } catch {
    // Fail-open: harness init errors never block the agent process

    return null
  }
}
