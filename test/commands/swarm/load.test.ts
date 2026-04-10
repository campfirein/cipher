/// <reference types="mocha" />

import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import {restore, stub} from 'sinon'

import type {buildSwarmGraph} from '../../../src/agent/infra/swarm/swarm-graph-builder.js'
import type {LoadedSwarm, SwarmSummary} from '../../../src/agent/infra/swarm/types.js'

import {CycleDetectedError} from '../../../src/agent/infra/swarm/engine/swarm-graph.js'
import {SwarmValidationError} from '../../../src/agent/infra/swarm/errors.js'
import {SwarmLoader} from '../../../src/agent/infra/swarm/swarm-loader.js'
import SwarmLoad from '../../../src/oclif/commands/swarm/load.js'

// ─── Mock data ───

const MOCK_LOADED_SWARM: LoadedSwarm = {
  agents: [
    {frontmatter: {description: 'Analyzer', name: 'Analyzer', role: 'worker', skills: [], slug: 'analyzer'}, prompt: 'Analyze.', sourcePath: '/s/agents/analyzer/AGENT.md'},
    {frontmatter: {description: 'Synth', name: 'Synth', role: 'worker', skills: [], slug: 'synthesizer'}, prompt: 'Synth.', sourcePath: '/s/agents/synthesizer/AGENT.md'},
  ],
  description: 'Test',
  frontmatter: {description: 'Test', goals: ['Test'], includes: [], name: 'Test Swarm', schema: 'byterover-swarm/v1', slug: 'test-swarm', version: '1.0.0'},
  runtimeConfig: {agents: {analyzer: {adapter: {type: 'claude_code'}}, synthesizer: {adapter: {type: 'process'}, output: true}}, edges: [{from: 'analyzer', to: 'synthesizer'}], potentialEdges: [], schema: 'byterover-swarm/v1'},
  sourceDir: '/s',
  warnings: [],
}

const MOCK_SUMMARY: SwarmSummary = {
  agentCount: 2,
  agents: [{adapterType: 'claude_code', slug: 'analyzer'}, {adapterType: 'process', slug: 'synthesizer'}],
  fixedEdgeCount: 1,
  name: 'Test Swarm',
  outputNodes: ['synthesizer'],
  potentialEdgeCount: 0,
  slug: 'test-swarm',
}

// ─── Testable subclass ───

class TestableSwarmLoad extends SwarmLoad {
  private mockBuilder?: typeof buildSwarmGraph
  private mockLoader?: SwarmLoader

  protected override createBuilder(): typeof buildSwarmGraph {
    return this.mockBuilder ?? super.createBuilder()
  }

  protected override createLoader(): SwarmLoader {
    return this.mockLoader ?? super.createLoader()
  }

  setMockBuilder(builder: typeof buildSwarmGraph): void {
    this.mockBuilder = builder
  }

  setMockLoader(loader: SwarmLoader): void {
    this.mockLoader = loader
  }
}

describe('SwarmLoad Command', () => {
  let config: Config
  let loggedMessages: string[]

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  afterEach(() => {
    restore()
  })

  function createCommand(...argv: string[]): TestableSwarmLoad {
    const command = new TestableSwarmLoad(argv, config)
    loggedMessages = []
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg) loggedMessages.push(msg)
    })

    return command
  }

  describe('happy path', () => {
    it('should log swarm summary on success', async () => {
      const command = createCommand('./my-swarm')

      const mockLoader = new SwarmLoader()
      stub(mockLoader, 'load').resolves(MOCK_LOADED_SWARM)
      command.setMockLoader(mockLoader)
      command.setMockBuilder(() => ({
        edgeDistribution: {} as never,
        graph: {} as never,
        summary: MOCK_SUMMARY,
      }))

      await command.run()

      expect(loggedMessages.some((m) => m.includes('Test Swarm'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('Agents: 2'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('analyzer [claude_code]'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('synthesizer [process]'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('Fixed edges: 1'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('Output nodes: synthesizer'))).to.be.true
    })

    it('should log warnings before summary', async () => {
      const loadedWithWarnings = {...MOCK_LOADED_SWARM, warnings: ['No agents have output: true.']}
      const command = createCommand('./my-swarm')

      const mockLoader = new SwarmLoader()
      stub(mockLoader, 'load').resolves(loadedWithWarnings)
      command.setMockLoader(mockLoader)
      command.setMockBuilder(() => ({
        edgeDistribution: {} as never,
        graph: {} as never,
        summary: MOCK_SUMMARY,
      }))

      await command.run()

      const warningIdx = loggedMessages.findIndex((m) => m.includes('Warning:'))
      const summaryIdx = loggedMessages.findIndex((m) => m.includes('Test Swarm'))
      expect(warningIdx).to.be.greaterThanOrEqual(0)
      expect(warningIdx).to.be.lessThan(summaryIdx)
    })
  })

  describe('error handling', () => {
    it('should throw on loader validation error', async () => {
      const command = createCommand('./bad-swarm')

      const mockLoader = new SwarmLoader()
      stub(mockLoader, 'load').rejects(new Error('SWARM.md not found'))
      command.setMockLoader(mockLoader)

      try {
        await command.run()
        expect.fail('should have thrown')
      } catch (error) {
        expect((error as Error).message).to.include('SWARM.md not found')
      }
    })

    it('should throw on cycle error from builder', async () => {
      const command = createCommand('./cycle-swarm')

      const mockLoader = new SwarmLoader()
      stub(mockLoader, 'load').resolves(MOCK_LOADED_SWARM)
      command.setMockLoader(mockLoader)
      command.setMockBuilder(() => {
        throw new CycleDetectedError()
      })

      try {
        await command.run()
        expect.fail('should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(CycleDetectedError)
      }
    })

    it('should throw on missing required dir arg', async () => {
      const command = createCommand()

      try {
        await command.run()
        expect.fail('should have thrown')
      } catch (error) {
        expect((error as Error).message).to.include('Missing')
      }
    })

    it('should log all errors from SwarmValidationError and exit 1', async () => {
      const command = createCommand('./bad-swarm')
      const exitStub = stub(command, 'exit').callsFake((code?: number) => {
        throw Object.assign(new Error('EXIT'), {oclif: {exit: code ?? 0}})
      })

      const mockLoader = new SwarmLoader()
      stub(mockLoader, 'load').rejects(
        new SwarmValidationError(['err1: bad slug', 'err2: bad edge', 'err3: duplicate'], ['warn1']),
      )
      command.setMockLoader(mockLoader)

      try {
        await command.run()
        expect.fail('should have thrown')
      } catch {
        // exit(1) throws the sentinel
      }

      expect(loggedMessages.some((m) => m.includes('warn1'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('err1: bad slug'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('err2: bad edge'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('err3: duplicate'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('3 error(s) found'))).to.be.true
      expect(exitStub.calledOnceWithExactly(1)).to.be.true
    })

    it('should log note after errors when present', async () => {
      const command = createCommand('./bad-swarm')
      stub(command, 'exit').callsFake((code?: number) => {
        throw Object.assign(new Error('EXIT'), {oclif: {exit: code ?? 0}})
      })

      const mockLoader = new SwarmLoader()
      stub(mockLoader, 'load').rejects(
        new SwarmValidationError(['err1'], [], 'Note: 1 file failed'),
      )
      command.setMockLoader(mockLoader)

      try {
        await command.run()
        expect.fail('should have thrown')
      } catch {
        // exit(1) throws sentinel
      }

      const errIdx = loggedMessages.findIndex((m) => m.includes('err1'))
      const noteIdx = loggedMessages.findIndex((m) => m.includes('Note: 1 file failed'))
      expect(errIdx).to.be.greaterThanOrEqual(0)
      expect(noteIdx).to.be.greaterThan(errIdx)
      // Note should NOT inflate error count
      expect(loggedMessages.some((m) => m.includes('1 error(s) found'))).to.be.true
    })
  })
})
