import type {LoadedSwarm, SwarmSummary} from './types.js'

import {EdgeDistribution} from './engine/edge-distribution.js'
import {SwarmGraph} from './engine/swarm-graph.js'
import {SwarmNode} from './engine/swarm-node.js'

/**
 * Build a validated SwarmGraph + EdgeDistribution from a LoadedSwarm.
 * Returns a summary DTO for CLI display.
 * Throws CycleDetectedError if fixed edges form a cycle.
 */
export function buildSwarmGraph(loaded: LoadedSwarm): {
  edgeDistribution: EdgeDistribution
  graph: SwarmGraph
  summary: SwarmSummary
} {
  const graph = new SwarmGraph()
  const {agents, frontmatter, runtimeConfig} = loaded

  // Create nodes (keyed by slug)
  for (const agent of agents) {
    graph.addNode(new SwarmNode({id: agent.frontmatter.slug, slug: agent.frontmatter.slug}))
  }

  // Wire fixed edges
  for (const edge of runtimeConfig.edges) {
    const from = graph.nodes.get(edge.from)!
    const to = graph.nodes.get(edge.to)!
    from.addSuccessor(to)
  }

  // Validate DAG (throws CycleDetectedError if cyclic)
  graph.topologicalSort()

  // Set output nodes
  const outputSlugs = Object.entries(runtimeConfig.agents)
    .filter(([, config]) => config.output === true)
    .map(([slug]) => slug)
  graph.setOutputNodes(outputSlugs)

  // Build edge distribution
  const potentialConnections: Array<[string, string]> = runtimeConfig.potentialEdges.map(
    (e) => [e.from, e.to],
  )
  const initialProbability = runtimeConfig.optimization?.edge?.initialProbability
  const edgeDistribution = new EdgeDistribution({
    initialProbability,
    potentialConnections,
  })

  // Build summary
  const summary: SwarmSummary = {
    agentCount: agents.length,
    agents: agents.map((a) => ({
      adapterType: runtimeConfig.agents[a.frontmatter.slug].adapter.type,
      slug: a.frontmatter.slug,
    })),
    fixedEdgeCount: runtimeConfig.edges.length,
    name: frontmatter.name,
    outputNodes: outputSlugs,
    potentialEdgeCount: runtimeConfig.potentialEdges.length,
    slug: frontmatter.slug,
  }

  return {edgeDistribution, graph, summary}
}
