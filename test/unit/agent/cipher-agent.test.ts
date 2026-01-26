import {expect} from 'chai'
import {restore, stub} from 'sinon'

import type {AgentConfig} from '../../../src/agent/infra/agent/index.js'

import {BRV_CONFIG_VERSION} from '../../../src/constants.js'
import {BrvConfig} from '../../../src/core/domain/entities/brv-config.js'
import {CipherAgent} from '../../../src/agent/infra/agent/index.js'

describe('CipherAgent', () => {
  let agentConfig: AgentConfig

  beforeEach(() => {
    agentConfig = {
      accessToken: 'test-access-token',
      apiBaseUrl: 'http://localhost:3333',
      blobStorage: {
        maxBlobSize: 100 * 1024 * 1024,
        maxTotalSize: 1024 * 1024 * 1024,
        storageDir: '.brv/blobs',
      },
      llm: {
        maxIterations: 10,
        maxTokens: 1000,
        temperature: 0.5,
      },
      model: 'gemini-2.5-flash',
      projectId: 'byterover',
      sessionKey: 'test-session-key',
    }
    stub(console, 'log')
  })

  afterEach(() => {
    restore()
  })

  describe('constructor', () => {
    it('should create instance with valid agent config', () => {
      const agent = new CipherAgent(agentConfig)

      expect(agent).to.be.instanceOf(CipherAgent)
    })

    it('should create instance with agent config and BRV config', () => {
      const brvConfig = new BrvConfig({
        chatLogPath: 'chat.log',
        cipherAgentSystemPrompt: 'Custom system prompt',
        createdAt: new Date().toISOString(),
        cwd: '/test/cwd',
        ide: 'Claude Code',
        spaceId: 'space-id',
        spaceName: 'Space Name',
        teamId: 'team-id',
        teamName: 'Team Name',
        version: BRV_CONFIG_VERSION,
      })

      const agent = new CipherAgent(agentConfig, brvConfig)

      expect(agent).to.be.instanceOf(CipherAgent)
    })

    it('should initialize with zero iterations', () => {
      const agent = new CipherAgent(agentConfig)

      const state = agent.getState()
      expect(state.currentIteration).to.equal(0)
      expect(state.executionHistory).to.deep.equal([])
    })
  })

  describe('getState', () => {
    it('should return initial state before start', () => {
      const agent = new CipherAgent(agentConfig)

      const state = agent.getState()

      expect(state).to.have.property('currentIteration')
      expect(state).to.have.property('executionHistory')
      expect(state.currentIteration).to.equal(0)
      expect(state.executionHistory).to.be.an('array').that.is.empty
    })

    it('should return independent state copies', () => {
      const agent = new CipherAgent(agentConfig)

      const state1 = agent.getState()
      const state2 = agent.getState()

      expect(state1).to.not.equal(state2)
      expect(state1.executionHistory).to.not.equal(state2.executionHistory)
    })
  })

  describe('reset', () => {
    it('should reset state to initial values after start', async () => {
      const agent = new CipherAgent(agentConfig)
      await agent.start()

      // Reset should clear state
      agent.reset()

      const state = agent.getState()
      expect(state.currentIteration).to.equal(0)
      expect(state.executionHistory).to.deep.equal([])
    })

    it('should allow reset before start (no event emission)', () => {
      const agent = new CipherAgent(agentConfig)

      // Reset is safe to call before start() - it just won't emit events
      // This is safer than the old implementation which would throw TypeError
      agent.reset()

      const state = agent.getState()
      expect(state.currentIteration).to.equal(0)
      expect(state.executionHistory).to.deep.equal([])
    })
  })

  describe('execute - error handling', () => {
    it('should throw error when execute is called before start', async () => {
      const agent = new CipherAgent(agentConfig)

      try {
        // Agent now uses its default session (created during start())
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
      const agent = new CipherAgent(agentConfig)

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
      const agent = new CipherAgent(agentConfig)

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
      const agent = new CipherAgent(agentConfig)

      // Phase 1: Constructor completes synchronously
      expect(agent).to.be.instanceOf(CipherAgent)
      expect(agent.getState().currentIteration).to.equal(0)

      // Phase 2: Must call start() before execute()
      // Agent now uses its default session (created during start())
      try {
        await agent.execute('test')
        expect.fail('Should require start() first')
      } catch (error) {
        expect((error as Error).message).to.include('must be started')
      }
    })

    it('should allow reset() before start() (safe behavior)', () => {
      const agent = new CipherAgent(agentConfig)

      // After refactoring to remove non-null assertions, reset() is now safe
      // to call before start() - it just won't emit events
      agent.reset()

      const state = agent.getState()
      expect(state.currentIteration).to.equal(0)
      expect(state.executionHistory).to.deep.equal([])
    })

    it('should allow getState() before start()', () => {
      const agent = new CipherAgent(agentConfig)

      // getState should work without start()
      const state = agent.getState()

      expect(state).to.have.property('currentIteration')
      expect(state).to.have.property('executionHistory')
    })
  })

  describe('switchDefaultSession', () => {
    it('should throw error when called before start', () => {
      const agent = new CipherAgent(agentConfig)

      try {
        agent.switchDefaultSession('some-session-id')
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('must be started')
      }
    })

    it('should throw error when session does not exist', async () => {
      const agent = new CipherAgent(agentConfig)
      await agent.start()

      try {
        agent.switchDefaultSession('non-existent-session-id')
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('does not exist')
        expect((error as Error).message).to.include('non-existent-session-id')
      }
    })

    it('should switch to existing session successfully', async () => {
      const agent = new CipherAgent(agentConfig)
      await agent.start()

      // Get the initial default session ID
      const initialSessionId = agent.sessionId
      expect(initialSessionId).to.be.a('string')

      // Create a new session
      const newSession = await agent.createSession('new-test-session')
      expect(newSession.id).to.equal('new-test-session')

      // Switch to the new session
      agent.switchDefaultSession('new-test-session')

      // Verify the default session ID has changed
      expect(agent.sessionId).to.equal('new-test-session')
      expect(agent.sessionId).to.not.equal(initialSessionId)
    })

    it('should allow switching back to original session', async () => {
      const agent = new CipherAgent(agentConfig)
      await agent.start()

      const originalSessionId = agent.sessionId!

      // Create and switch to a new session
      await agent.createSession('temp-session')
      agent.switchDefaultSession('temp-session')
      expect(agent.sessionId).to.equal('temp-session')

      // Switch back to original
      agent.switchDefaultSession(originalSessionId)
      expect(agent.sessionId).to.equal(originalSessionId)
    })
  })

  describe('interface compliance', () => {
    it('should implement all ICipherAgent methods', () => {
      const agent = new CipherAgent(agentConfig)

      // Check that all required methods exist
      expect(agent).to.have.property('start').that.is.a('function')
      expect(agent).to.have.property('execute').that.is.a('function')
      expect(agent).to.have.property('getState').that.is.a('function')
      expect(agent).to.have.property('reset').that.is.a('function')
      expect(agent).to.have.property('switchDefaultSession').that.is.a('function')
    })

    it('should expose agentEventBus after start', async () => {
      const agent = new CipherAgent(agentConfig)

      await agent.start()

      expect(agent).to.have.property('agentEventBus')
      expect(agent.agentEventBus).to.have.property('on')
      expect(agent.agentEventBus).to.have.property('emit')
    })
  })
})
