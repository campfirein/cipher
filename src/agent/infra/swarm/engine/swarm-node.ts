/**
 * A node in the swarm DAG.
 * Ported from GPTSwarm's Node class (swarm/graph/node.py).
 * Manages bidirectional predecessor/successor links.
 */
export class SwarmNode {
  readonly id: string
  readonly predecessors: SwarmNode[] = []
  readonly slug: string
  readonly successors: SwarmNode[] = []

  constructor(props: {id: string; slug: string}) {
    this.id = props.id
    this.slug = props.slug
  }

  addPredecessor(node: SwarmNode): void {
    if (!this.predecessors.includes(node)) {
      this.predecessors.push(node)
      node.successors.push(this)
    }
  }

  addSuccessor(node: SwarmNode): void {
    if (!this.successors.includes(node)) {
      this.successors.push(node)
      node.predecessors.push(this)
    }
  }

  removePredecessor(node: SwarmNode): void {
    const idx = this.predecessors.indexOf(node)
    if (idx !== -1) {
      this.predecessors.splice(idx, 1)
      const sIdx = node.successors.indexOf(this)
      if (sIdx !== -1) node.successors.splice(sIdx, 1)
    }
  }

  removeSuccessor(node: SwarmNode): void {
    const idx = this.successors.indexOf(node)
    if (idx !== -1) {
      this.successors.splice(idx, 1)
      const pIdx = node.predecessors.indexOf(this)
      if (pIdx !== -1) node.predecessors.splice(pIdx, 1)
    }
  }
}
