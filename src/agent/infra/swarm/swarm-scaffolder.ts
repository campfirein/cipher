import {dump as yamlDump} from 'js-yaml'

import type {AdapterType} from './types.js'

// ─── Input / Output Types ───

export type ScaffoldInput = {
  agents: Array<{adapterType: AdapterType; description: string; name: string; role?: string; slug: string}>
  description: string
  edges: Array<{from: string; to: string}>
  goals: string[]
  name: string
  outputNodeSlug: string
  slug: string
}

// ─── Scaffolder ───

/**
 * Pure function: generates swarm spec files from structured input.
 * Returns a map of relative file paths to file content strings.
 * Zero I/O — caller is responsible for writing to disk.
 */
export function scaffoldSwarm(input: ScaffoldInput): Record<string, string> {
  const files: Record<string, string> = {}

  // SWARM.md
  const swarmFrontmatter = {
    description: input.description,
    goals: input.goals,
    includes: input.agents.map((a) => `agents/${a.slug}/AGENT.md`),
    name: input.name,
    schema: 'byterover-swarm/v1',
    slug: input.slug,
    version: '1.0.0',
  }
  const swarmYaml = yamlDump(swarmFrontmatter, {lineWidth: -1, sortKeys: true}).trimEnd()
  files['SWARM.md'] = `---\n${swarmYaml}\n---\n\n${input.description}\n`

  // AGENT.md per agent
  for (const agent of input.agents) {
    const agentFrontmatter = {
      description: agent.description,
      name: agent.name,
      role: agent.role ?? 'worker',
      slug: agent.slug,
    }
    const agentYaml = yamlDump(agentFrontmatter, {lineWidth: -1, sortKeys: true}).trimEnd()
    const prompt = `Describe the behavior of the ${agent.name} agent here.`
    files[`agents/${agent.slug}/AGENT.md`] = `---\n${agentYaml}\n---\n\n${prompt}\n`
  }

  // .swarm.yaml
  const agentsConfig: Record<string, Record<string, unknown>> = {}
  for (const agent of input.agents) {
    const config: Record<string, unknown> = {
      adapter: {type: agent.adapterType},
    }
    if (agent.slug === input.outputNodeSlug) {
      config.output = true
    }

    agentsConfig[agent.slug] = config
  }

  const swarmConfig: Record<string, unknown> = {
    agents: agentsConfig,
    edges: input.edges.map((e) => ({from: e.from, to: e.to})),
    potential_edges: [], // eslint-disable-line camelcase
    schema: 'byterover-swarm/v1',
  }
  files['.swarm.yaml'] = yamlDump(swarmConfig, {lineWidth: -1}).trimEnd() + '\n'

  return files
}
