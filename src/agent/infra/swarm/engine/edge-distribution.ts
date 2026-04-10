import {SwarmGraph} from './swarm-graph.js'
import {SwarmNode} from './swarm-node.js'

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

/**
 * EdgeWise distribution over potential connections.
 * Ported from GPTSwarm's EdgeWiseDistribution (parameterization.py).
 *
 * Each potential edge has a logit parameter. realize() samples a concrete
 * DAG by including/excluding each edge stochastically via Bernoulli sampling.
 */
export class EdgeDistribution {
  readonly edgeLogits: Float64Array
  readonly potentialConnections: ReadonlyArray<[string, string]>

  constructor(props: {initialProbability?: number; potentialConnections: Array<[string, string]>}) {
    this.potentialConnections = props.potentialConnections
    const p = Math.max(1e-7, Math.min(1 - 1e-7, props.initialProbability ?? 0.5))
    const initLogit = Math.log(p / (1 - p))
    this.edgeLogits = new Float64Array(props.potentialConnections.length)
    this.edgeLogits.fill(initLogit)
  }

  realize(props: {
    graph: SwarmGraph
    random?: () => number
    temperature?: number
    threshold?: number
  }): {graph: SwarmGraph; logProb: number} {
    const {graph, random = Math.random, temperature = 1, threshold} = props

    if (this.potentialConnections.length === 0) {
      return {graph, logProb: 0}
    }

    // Deep-clone graph nodes so we don't mutate the original
    const clonedNodes = new Map<string, SwarmNode>()
    for (const [id, node] of graph.nodes) {
      clonedNodes.set(id, new SwarmNode({id, slug: node.slug}))
    }

    // Rebuild existing edges on cloned nodes
    for (const [, original] of graph.nodes) {
      const cloned = clonedNodes.get(original.id)!
      for (const successor of original.successors) {
        const clonedSuccessor = clonedNodes.get(successor.id)
        if (clonedSuccessor) {
          cloned.addSuccessor(clonedSuccessor)
        }
      }
    }

    const newGraph = new SwarmGraph()
    for (const node of clonedNodes.values()) {
      newGraph.addNode(node)
    }

    // Copy output nodes
    const outputSlugs = graph.outputNodes.map((n) => n.slug)
    if (outputSlugs.length > 0) {
      newGraph.setOutputNodes(outputSlugs)
    }

    let logProb = 0

    for (let i = 0; i < this.potentialConnections.length; i++) {
      const [fromId, toId] = this.potentialConnections[i]
      const fromNode = clonedNodes.get(fromId)
      const toNode = clonedNodes.get(toId)

      if (!fromNode || !toNode) continue

      // Check if adding this edge would create a cycle
      if (SwarmGraph.checkCycle(toNode, fromNode)) continue

      const edgeProb = threshold === undefined
        ? sigmoid(this.edgeLogits[i] / temperature)
        : (sigmoid(this.edgeLogits[i] / temperature) > threshold ? 1 : 0)

      if (random() < edgeProb) {
        fromNode.addSuccessor(toNode)
        logProb += Math.log(edgeProb)
      } else {
        logProb += Math.log(1 - edgeProb)
      }
    }

    return {graph: newGraph, logProb}
  }
}
