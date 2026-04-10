/// <reference types="mocha" />

import {expect} from 'chai'
import {load as yamlLoad} from 'js-yaml'
import path from 'node:path'

import type {SwarmFileReader} from '../../../../src/agent/infra/swarm/types.js'

import {parseFrontmatter} from '../../../../src/agent/infra/swarm/frontmatter.js'
import {SwarmLoader} from '../../../../src/agent/infra/swarm/swarm-loader.js'
import {scaffoldSwarm} from '../../../../src/agent/infra/swarm/swarm-scaffolder.js'

// ─── In-memory reader for roundtrip test ───

function readerFromScaffold(files: Record<string, string>, root: string): SwarmFileReader {
  const normalized = new Map<string, string>()
  for (const [relPath, content] of Object.entries(files)) {
    normalized.set(path.resolve(root, relPath), content)
  }

  return {
    async exists(p: string) {
      const resolved = path.resolve(p)
      return normalized.has(resolved) || [...normalized.keys()].some((k) => k.startsWith(resolved + '/'))
    },
    async glob(dir: string, pattern: string) {
      const resolvedDir = path.resolve(dir)
      const suffix = pattern.replace('**/', '')
      return [...normalized.keys()].filter((k) => k.startsWith(resolvedDir + '/') && k.endsWith(suffix))
    },
    async isDirectory(p: string) {
      const resolved = path.resolve(p)
      return !normalized.has(resolved) && [...normalized.keys()].some((k) => k.startsWith(resolved + '/'))
    },
    async readFile(p: string) {
      const resolved = path.resolve(p)
      const content = normalized.get(resolved)
      if (content === undefined) throw new Error(`ENOENT: ${resolved}`)
      return content
    },
  }
}

const TWO_AGENT_INPUT = {
  agents: [
    {adapterType: 'claude_code' as const, description: 'Code analyzer', name: 'Analyzer', slug: 'analyzer'},
    {adapterType: 'hermes' as const, description: 'Synthesis agent', name: 'Synthesizer', slug: 'synthesizer'},
  ],
  description: 'A two-agent code review pipeline.',
  edges: [{from: 'analyzer', to: 'synthesizer'}],
  goals: ['Find bugs', 'Produce reviews'],
  name: 'Code Review',
  outputNodeSlug: 'synthesizer',
  slug: 'code-review',
}

describe('scaffoldSwarm', () => {
  it('should generate correct file keys for 2-agent input', () => {
    const files = scaffoldSwarm(TWO_AGENT_INPUT)

    expect(files).to.have.property('SWARM.md')
    expect(files).to.have.property('agents/analyzer/AGENT.md')
    expect(files).to.have.property('agents/synthesizer/AGENT.md')
    expect(files).to.have.property('.swarm.yaml')
    expect(Object.keys(files)).to.have.lengthOf(4)
  })

  it('should generate valid SWARM.md with correct frontmatter', () => {
    const files = scaffoldSwarm(TWO_AGENT_INPUT)
    const parsed = parseFrontmatter(files['SWARM.md'])

    expect(parsed).to.not.be.null
    expect(parsed!.frontmatter).to.have.property('name', 'Code Review')
    expect(parsed!.frontmatter).to.have.property('slug', 'code-review')
    expect(parsed!.frontmatter).to.have.property('schema', 'byterover-swarm/v1')
    expect((parsed!.frontmatter as Record<string, unknown>).includes).to.deep.equal([
      'agents/analyzer/AGENT.md',
      'agents/synthesizer/AGENT.md',
    ])
  })

  it('should generate valid .swarm.yaml with output flag on correct agent', () => {
    const files = scaffoldSwarm(TWO_AGENT_INPUT)
    const yaml = yamlLoad(files['.swarm.yaml']) as Record<string, unknown>

    expect(yaml).to.have.property('schema', 'byterover-swarm/v1')
    const agents = yaml.agents as Record<string, Record<string, unknown>>
    expect(agents.synthesizer).to.have.property('output', true)
    expect(agents.analyzer).to.not.have.property('output')
  })

  it('should use role: worker by default', () => {
    const files = scaffoldSwarm(TWO_AGENT_INPUT)
    const parsed = parseFrontmatter(files['agents/analyzer/AGENT.md'])

    expect(parsed).to.not.be.null
    expect(parsed!.frontmatter).to.have.property('role', 'worker')
  })

  it('should roundtrip through SwarmLoader without errors', async () => {
    const files = scaffoldSwarm(TWO_AGENT_INPUT)
    const root = '/scaffold-test'
    const reader = readerFromScaffold(files, root)
    const loader = new SwarmLoader({fileReader: reader})

    const loaded = await loader.load(root)

    expect(loaded.frontmatter.name).to.equal('Code Review')
    expect(loaded.agents).to.have.lengthOf(2)
    expect(loaded.runtimeConfig.edges).to.have.lengthOf(1)
    expect(loaded.warnings).to.deep.equal([])
  })

  it('should handle single agent with zero edges', () => {
    const files = scaffoldSwarm({
      agents: [{adapterType: 'hermes', description: 'Solo', name: 'Solo', slug: 'solo'}],
      description: 'Single agent.',
      edges: [],
      goals: ['Do one thing'],
      name: 'Solo Swarm',
      outputNodeSlug: 'solo',
      slug: 'solo-swarm',
    })

    expect(Object.keys(files)).to.have.lengthOf(3) // SWARM.md, AGENT.md, .swarm.yaml
    const yaml = yamlLoad(files['.swarm.yaml']) as Record<string, unknown>
    expect((yaml as Record<string, unknown>).edges).to.deep.equal([])
  })

  it('should roundtrip single agent through SwarmLoader', async () => {
    const files = scaffoldSwarm({
      agents: [{adapterType: 'hermes', description: 'Solo', name: 'Solo', slug: 'solo'}],
      description: 'Single.',
      edges: [],
      goals: ['Test'],
      name: 'Solo',
      outputNodeSlug: 'solo',
      slug: 'solo',
    })
    const root = '/solo-test'
    const reader = readerFromScaffold(files, root)
    const loader = new SwarmLoader({fileReader: reader})

    const loaded = await loader.load(root)

    expect(loaded.agents).to.have.lengthOf(1)
    expect(loaded.warnings).to.deep.equal([])
  })
})
