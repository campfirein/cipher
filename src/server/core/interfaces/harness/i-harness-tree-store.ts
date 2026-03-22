/**
 * Interface and types for the AutoHarness hypothesis tree storage.
 *
 * Each node in the tree represents a candidate template (YAML configuration)
 * that has been synthesized or refined by the LLM. The tree is used for
 * Thompson-sampling-based template selection.
 */

/**
 * A single node in the hypothesis tree.
 * Each node holds a template (YAML config) and its performance statistics.
 */
export interface HarnessNode {
  /** Beta distribution failure count (exploration/exploitation) */
  alpha: number
  /** Beta distribution success count (exploration/exploitation) */
  beta: number
  /** IDs of child nodes (refined versions of this template) */
  childIds: string[]
  /** Timestamp when this node was created (ms) */
  createdAt: number
  /** Success rate [0, 1] — computed from alpha/(alpha+beta) */
  heuristic: number
  /** Unique node identifier (UUID) */
  id: string
  /** Domain-specific metadata (e.g., input type, refinement reason) */
  metadata: Record<string, unknown>
  /** Parent node ID (null for root) */
  parentId: null | string
  /** The YAML configuration template content */
  templateContent: string
  /** Number of times this node has been selected for evaluation */
  visitCount: number
}

/**
 * Persistence interface for the harness hypothesis tree.
 * Each domain (curation, reorg, query/*) maintains its own tree.
 */
export interface IHarnessTreeStore {
  /** Delete a node from the tree. */
  deleteNode(domain: string, nodeId: string): Promise<void>
  /** Retrieve all nodes for a domain. */
  getAllNodes(domain: string): Promise<HarnessNode[]>
  /** Retrieve a single node by ID. Returns null if not found. */
  getNode(domain: string, nodeId: string): Promise<HarnessNode | null>
  /** Retrieve the root node (parentId === null). Returns null if tree is empty. */
  getRootNode(domain: string): Promise<HarnessNode | null>
  /** Save or update a node. */
  saveNode(domain: string, node: HarnessNode): Promise<void>
}
