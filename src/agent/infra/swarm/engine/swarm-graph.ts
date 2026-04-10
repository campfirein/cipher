import type {SwarmNode} from './swarm-node.js'

/**
 * Error thrown when the graph contains a cycle.
 */
export class CycleDetectedError extends Error {
  constructor(message?: string) {
    super(message ?? 'Cycle detected in swarm graph')
    this.name = 'CycleDetectedError'
  }
}

/**
 * Directed acyclic graph of SwarmNodes.
 * Ported from GPTSwarm's Graph class (swarm/graph/graph.py).
 */
export class SwarmGraph {
  readonly nodes = new Map<string, SwarmNode>()
  private _outputNodes: SwarmNode[] = []

  /**
   * DFS-based cycle check: returns true if target is reachable from source
   * via successor edges. Ported from GPTSwarm's CompositeGraph.check_cycle().
   */
  static checkCycle(source: SwarmNode, target: SwarmNode): boolean {
    const visited = new Set<string>()

    function dfs(node: SwarmNode): boolean {
      if (node === target) return true
      if (visited.has(node.id)) return false
      visited.add(node.id)

      for (const successor of node.successors) {
        if (dfs(successor)) return true
      }

      return false
    }

    for (const successor of source.successors) {
      if (dfs(successor)) return true
    }

    return false
  }

  get edgeCount(): number {
    let count = 0
    for (const node of this.nodes.values()) {
      count += node.successors.length
    }

    return count
  }

  get nodeCount(): number {
    return this.nodes.size
  }

  get outputNodes(): SwarmNode[] {
    return this._outputNodes
  }

  addNode(node: SwarmNode): void {
    if (this.nodes.has(node.id)) {
      throw new Error(`Duplicate node id: "${node.id}"`)
    }

    this.nodes.set(node.id, node)
  }

  computeInDegrees(): Map<string, number> {
    const degrees = new Map<string, number>()
    for (const id of this.nodes.keys()) {
      degrees.set(id, 0)
    }

    for (const node of this.nodes.values()) {
      for (const successor of node.successors) {
        degrees.set(successor.id, (degrees.get(successor.id) ?? 0) + 1)
      }
    }

    return degrees
  }

  setOutputNodes(slugs: string[]): void {
    this._outputNodes = []
    for (const slug of slugs) {
      for (const node of this.nodes.values()) {
        if (node.slug === slug) {
          this._outputNodes.push(node)

          break
        }
      }
    }
  }

  /**
   * Kahn's algorithm for topological sort.
   * Throws CycleDetectedError if the graph contains a cycle.
   */
  topologicalSort(): string[] {
    const inDegrees = this.computeInDegrees()
    const queue: string[] = []
    const result: string[] = []

    for (const [id, deg] of inDegrees) {
      if (deg === 0) queue.push(id)
    }

    while (queue.length > 0) {
      const current = queue.shift()!
      result.push(current)
      const node = this.nodes.get(current)!

      for (const successor of node.successors) {
        const newDeg = (inDegrees.get(successor.id) ?? 1) - 1
        inDegrees.set(successor.id, newDeg)
        if (newDeg === 0) queue.push(successor.id)
      }
    }

    if (result.length !== this.nodes.size) {
      throw new CycleDetectedError()
    }

    return result
  }
}
