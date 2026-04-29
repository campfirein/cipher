/**
 * DAG builder for the default Phase 1 curate-flow topology.
 *
 * Linear chain: recon → chunk → extract → group → dedup → conflict → write.
 * Every node is identified by its slot name (e.g., id === 'recon'). Phase 8
 * (positional insertion) will allow user-defined slots between adjacent
 * base slots; Phase 1 ships only this canonical chain.
 */

import type {CurationDAG, CurationNode} from '../../../core/curation/flow/runner.js'

import {NODE_SLOT_ORDER} from '../../../core/curation/flow/types.js'
import {createChunkNode} from './nodes/chunk-node.js'
import {createConflictNode} from './nodes/conflict-node.js'
import {createDedupNode} from './nodes/dedup-node.js'
import {createExtractNode} from './nodes/extract-node.js'
import {createGroupNode} from './nodes/group-node.js'
import {createReconNode} from './nodes/recon-node.js'
import {createWriteNode} from './nodes/write-node.js'

export interface CurationDAGConfig {
  /**
   * Bounded concurrency for sibling-node execution at the same topological
   * level. Phase 1 default is 1 (sequential); Phase 2 lifts this for
   * parallel ExtractNode fan-out.
   */
  readonly maxConcurrency?: number
}

export function buildCurationDAG(config?: CurationDAGConfig): CurationDAG {
  const nodes: Record<string, CurationNode<unknown, unknown>> = {
    chunk: createChunkNode() as CurationNode<unknown, unknown>,
    conflict: createConflictNode() as CurationNode<unknown, unknown>,
    dedup: createDedupNode() as CurationNode<unknown, unknown>,
    extract: createExtractNode() as CurationNode<unknown, unknown>,
    group: createGroupNode() as CurationNode<unknown, unknown>,
    recon: createReconNode() as CurationNode<unknown, unknown>,
    write: createWriteNode() as CurationNode<unknown, unknown>,
  }

  // Build the linear chain by walking NODE_SLOT_ORDER pairs.
  const edges: Array<{from: string; to: string}> = []
  for (let i = 0; i < NODE_SLOT_ORDER.length - 1; i++) {
    edges.push({from: NODE_SLOT_ORDER[i], to: NODE_SLOT_ORDER[i + 1]})
  }

  return {
    edges,
    entryNodeIds: [NODE_SLOT_ORDER[0]],
    exitNodeIds: [NODE_SLOT_ORDER.at(-1) as string],
    maxConcurrency: config?.maxConcurrency ?? 1,
    nodes,
  }
}
