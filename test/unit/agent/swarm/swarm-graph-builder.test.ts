/// <reference types="mocha" />

import {expect} from 'chai'

import type {LoadedSwarm} from '../../../../src/agent/infra/swarm/types.js'

import {CycleDetectedError} from '../../../../src/agent/infra/swarm/engine/swarm-graph.js'
import {buildSwarmGraph} from '../../../../src/agent/infra/swarm/swarm-graph-builder.js'

function makeLoadedSwarm(overrides?: Partial<LoadedSwarm>): LoadedSwarm {
  return {
    agents: [
      {frontmatter: {description: 'Analyzer', name: 'Analyzer', role: 'worker', skills: [], slug: 'analyzer'}, prompt: 'Analyze.', sourcePath: '/s/agents/analyzer/AGENT.md'},
      {frontmatter: {description: 'Synthesizer', name: 'Synthesizer', role: 'worker', skills: [], slug: 'synthesizer'}, prompt: 'Synthesize.', sourcePath: '/s/agents/synthesizer/AGENT.md'},
    ],
    description: 'Test swarm',
    frontmatter: {
      description: 'Test',
      goals: ['Test'],
      includes: ['agents/analyzer/AGENT.md', 'agents/synthesizer/AGENT.md'],
      name: 'Test Swarm',
      schema: 'byterover-swarm/v1',
      slug: 'test-swarm',
      version: '1.0.0',
    },
    runtimeConfig: {
      agents: {
        analyzer: {adapter: {type: 'claude_code'}, timeoutSec: 120},
        synthesizer: {adapter: {config: {command: 'echo'}, type: 'process'}, output: true, timeoutSec: 60},
      },
      edges: [{from: 'analyzer', to: 'synthesizer'}],
      potentialEdges: [{from: 'synthesizer', to: 'analyzer'}],
      schema: 'byterover-swarm/v1',
    },
    sourceDir: '/s',
    warnings: [],
    ...overrides,
  }
}

describe('buildSwarmGraph', () => {
  it('should create one node per agent', () => {
    const result = buildSwarmGraph(makeLoadedSwarm())

    expect(result.graph.nodeCount).to.equal(2)
    expect(result.graph.nodes.has('analyzer')).to.be.true
    expect(result.graph.nodes.has('synthesizer')).to.be.true
  })

  it('should wire fixed edges correctly', () => {
    const result = buildSwarmGraph(makeLoadedSwarm())

    const analyzer = result.graph.nodes.get('analyzer')!
    expect(analyzer.successors.some((n) => n.id === 'synthesizer')).to.be.true
  })

  it('should pass potential edges to EdgeDistribution', () => {
    const result = buildSwarmGraph(makeLoadedSwarm())

    expect(result.edgeDistribution.potentialConnections).to.deep.equal([['synthesizer', 'analyzer']])
  })

  it('should set output nodes from agents with output: true', () => {
    const result = buildSwarmGraph(makeLoadedSwarm())

    expect(result.graph.outputNodes).to.have.lengthOf(1)
    expect(result.graph.outputNodes[0].slug).to.equal('synthesizer')
  })

  it('should return correct summary', () => {
    const result = buildSwarmGraph(makeLoadedSwarm())

    expect(result.summary.name).to.equal('Test Swarm')
    expect(result.summary.slug).to.equal('test-swarm')
    expect(result.summary.agentCount).to.equal(2)
    expect(result.summary.fixedEdgeCount).to.equal(1)
    expect(result.summary.potentialEdgeCount).to.equal(1)
    expect(result.summary.outputNodes).to.deep.equal(['synthesizer'])
    expect(result.summary.agents).to.deep.equal([
      {adapterType: 'claude_code', slug: 'analyzer'},
      {adapterType: 'process', slug: 'synthesizer'},
    ])
  })

  it('should throw CycleDetectedError if fixed edges form a cycle', () => {
    const loaded = makeLoadedSwarm({
      runtimeConfig: {
        agents: {
          a: {adapter: {type: 'process'}, timeoutSec: 60},
          b: {adapter: {type: 'process'}, output: true, timeoutSec: 60},
        },
        edges: [{from: 'a', to: 'b'}, {from: 'b', to: 'a'}],
        potentialEdges: [],
        schema: 'byterover-swarm/v1',
      },
    })
    loaded.agents = [
      {frontmatter: {description: 'A', name: 'A', role: 'worker', skills: [], slug: 'a'}, prompt: 'A.', sourcePath: '/s/a'},
      {frontmatter: {description: 'B', name: 'B', role: 'worker', skills: [], slug: 'b'}, prompt: 'B.', sourcePath: '/s/b'},
    ]

    expect(() => buildSwarmGraph(loaded)).to.throw(CycleDetectedError)
  })

  it('should work with zero potential edges', () => {
    const loaded = makeLoadedSwarm()
    loaded.runtimeConfig.potentialEdges = []

    const result = buildSwarmGraph(loaded)

    expect(result.edgeDistribution.potentialConnections).to.have.lengthOf(0)
    expect(result.summary.potentialEdgeCount).to.equal(0)
  })
})
