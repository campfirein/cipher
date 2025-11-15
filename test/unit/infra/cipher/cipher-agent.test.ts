import {expect} from 'chai'

import type {CipherLLMConfig} from '../../../../src/infra/cipher/agent-service-factory.js'

import {BrvConfig} from '../../../../src/core/domain/entities/brv-config.js'
import {CipherAgent} from '../../../../src/infra/cipher/cipher-agent.js'

describe('CipherAgent', () => {
  let llmConfig: CipherLLMConfig

  beforeEach(() => {
    llmConfig = {
      accessToken: 'test-access-token',
      grpcEndpoint: 'localhost:50051',
      maxIterations: 10,
      maxTokens: 1000,
      model: 'gemini-2.5-flash',
      projectId: 'byterover',
      sessionKey: 'test-session-key',
      temperature: 0.5,
    }
  })

  describe('constructor', () => {
    it('should create instance with valid LLM config', () => {
      const agent = new CipherAgent(llmConfig)

      expect(agent).to.be.instanceOf(CipherAgent)
    })

    it('should create instance with LLM config and BRV config', () => {
      const brvConfig = new BrvConfig(
        new Date().toISOString(),
        'space-id',
        'Space Name',
        'team-id',
        'Team Name',
        'Custom system prompt',
      )

      const agent = new CipherAgent(llmConfig, brvConfig)

      expect(agent).to.be.instanceOf(CipherAgent)
    })

    it('should initialize with zero iterations', () => {
      const agent = new CipherAgent(llmConfig)

      const state = agent.getState()
      expect(state.currentIteration).to.equal(0)
      expect(state.executionHistory).to.deep.equal([])
    })
  })

  describe('getState', () => {
    it('should return initial state before start', () => {
      const agent = new CipherAgent(llmConfig)

      const state = agent.getState()

      expect(state).to.have.property('currentIteration')
      expect(state).to.have.property('executionHistory')
      expect(state.currentIteration).to.equal(0)
      expect(state.executionHistory).to.be.an('array').that.is.empty
    })

    it('should return independent state copies', () => {
      const agent = new CipherAgent(llmConfig)

      const state1 = agent.getState()
      const state2 = agent.getState()

      expect(state1).to.not.equal(state2)
      expect(state1.executionHistory).to.not.equal(state2.executionHistory)
    })
  })

  describe('reset', () => {
    it('should reset state to initial values after start', async () => {
      const agent = new CipherAgent(llmConfig)
      await agent.start()

      // Reset should clear state
      agent.reset()

      const state = agent.getState()
      expect(state.currentIteration).to.equal(0)
      expect(state.executionHistory).to.deep.equal([])
    })

    it('should throw error when reset is called before start', () => {
      const agent = new CipherAgent(llmConfig)

      // Reset requires agentEventBus which is only initialized after start()
      try {
        agent.reset()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.instanceOf(TypeError)
      }
    })
  })

  describe('execute - error handling', () => {
    it('should throw error when execute is called before start', async () => {
      const agent = new CipherAgent(llmConfig)

      try {
        await agent.execute('test input')
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('must be started')
      }
    })
  })

  describe('getSystemPrompt - error handling', () => {
    it('should throw error when getSystemPrompt is called before start', async () => {
      const agent = new CipherAgent(llmConfig)

      try {
        await agent.getSystemPrompt()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('must be started')
      }
    })
  })

  describe('start', () => {
    it('should throw error when start is called twice', async () => {
      const agent = new CipherAgent(llmConfig)

      await agent.start()

      try {
        await agent.start()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('already started')
      }
    })
  })

  describe('two-phase initialization pattern', () => {
    it('should require start() before execute()', async () => {
      const agent = new CipherAgent(llmConfig)

      // Phase 1: Constructor completes synchronously
      expect(agent).to.be.instanceOf(CipherAgent)
      expect(agent.getState().currentIteration).to.equal(0)

      // Phase 2: Must call start() before execute()
      try {
        await agent.execute('test')
        expect.fail('Should require start() first')
      } catch (error) {
        expect((error as Error).message).to.include('must be started')
      }
    })

    it('should require start() before reset()', () => {
      const agent = new CipherAgent(llmConfig)

      // Reset requires start() to initialize agentEventBus
      try {
        agent.reset()
        expect.fail('Should require start() first')
      } catch (error) {
        expect(error).to.be.instanceOf(TypeError)
      }
    })

    it('should allow getState() before start()', () => {
      const agent = new CipherAgent(llmConfig)

      // getState should work without start()
      const state = agent.getState()

      expect(state).to.have.property('currentIteration')
      expect(state).to.have.property('executionHistory')
    })
  })

  describe('interface compliance', () => {
    it('should implement all ICipherAgent methods', () => {
      const agent = new CipherAgent(llmConfig)

      // Check that all required methods exist
      expect(agent).to.have.property('start').that.is.a('function')
      expect(agent).to.have.property('execute').that.is.a('function')
      expect(agent).to.have.property('getState').that.is.a('function')
      expect(agent).to.have.property('reset').that.is.a('function')
    })

    it('should expose agentEventBus after start', async () => {
      const agent = new CipherAgent(llmConfig)

      await agent.start()

      expect(agent).to.have.property('agentEventBus')
      expect(agent.agentEventBus).to.have.property('on')
      expect(agent.agentEventBus).to.have.property('emit')
    })
  })
})
