import {expect} from 'chai'
import {setTimeout} from 'node:timers/promises'
import * as sinon from 'sinon'

import {CleanSession} from '../../../../src/core/domain/entities/parser.js'
import {CipherLLMConfig} from '../../../../src/infra/cipher/agent-service-factory.js'
import {CipherAgent} from '../../../../src/infra/cipher/cipher-agent.js'

const createSampleCleanExternalSession = (overrides?: Partial<CleanSession>): CleanSession => ({
  id: 'test-session-123',
  messages: [
    {
      content: [{text: 'Hello', type: 'text'}],
      timestamp: new Date().toISOString(),
      type: 'user',
    },
    {
      content: [{text: 'Hi there!', type: 'text'}],
      timestamp: new Date().toISOString(),
      type: 'assistant',
    },
  ],
  metadata: {test: 'data'},
  timestamp: Date.now(),
  title: 'Test Session',
  type: 'Claude',
  workspacePaths: ['/test/workspace'],
  ...overrides,
})

describe('CipherAgent - processCleanExternalSession', () => {
  let agent: CipherAgent
  let llmConfig: CipherLLMConfig
  let consoleErrorStub: sinon.SinonStub

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

    agent = new CipherAgent(llmConfig)

    sinon.stub(console, 'log')
    consoleErrorStub = sinon.stub(console, 'error')
  })

  afterEach(() => {
    sinon.restore()
  })

  describe('method accessibility and structure', () => {
    it('should have processCleanExternalSession method', async () => {
      await agent.start()

      const method = agent.processCleanExternalSession
      expect(method).to.be.a('function')
    })
  })

  describe('successful processing', () => {
    it('should stringify CleanSession and call execute with correct parameters', async () => {
      await agent.start()

      const session = createSampleCleanExternalSession()
      const executeStub = sinon.stub(agent, 'execute').resolves('Success')
      const deleteSessionStub = sinon.stub(agent, 'deleteSession').resolves(true)

      await agent.processCleanExternalSession(session)

      // Verify execute was called with stringified session
      expect(executeStub.calledOnce).to.be.true
      const [prompt, sessionId, options] = executeStub.firstCall.args

      // Verify prompt contains stringified session
      expect(prompt).to.include('Process the following external coding session into the context tree')
      expect(prompt).to.include(JSON.stringify(session, null, 2))

      // Verify sessionId format
      expect(sessionId).to.match(/^test-session-123-process-\d+$/)

      // Verify execution options
      expect(options).to.deep.equal({
        executionContext: {
          commandType: 'add',
        },
        mode: 'autonomous',
      })

      // Verify cleanup
      expect(deleteSessionStub.calledOnce).to.be.true
    })

    it('should emit processing start event with correct payload', async () => {
      await agent.start()

      const session = createSampleCleanExternalSession({
        title: 'Cursor Session',
        type: 'Cursor',
      })

      sinon.stub(agent, 'execute').resolves('Success')
      sinon.stub(agent, 'deleteSession').resolves(true)

      const eventPayloads: unknown[] = []
      agent.agentEventBus?.on('cipher:cleanExternalSessionProcessing', (payload) => {
        eventPayloads.push(payload)
      })

      await agent.processCleanExternalSession(session)

      expect(eventPayloads).to.have.lengthOf(1)
      expect(eventPayloads[0]).to.deep.equal({
        codingAgent: 'Cursor',
        externalSessionTitle: 'Cursor Session',
      })
    })

    it('should emit success event with correct payload', async () => {
      await agent.start()

      const session = createSampleCleanExternalSession({
        id: 'session-456',
        messages: [
          {
            content: [{text: 'test', type: 'text'}],
            timestamp: new Date().toISOString(),
            type: 'user',
          },
          {
            content: [{text: 'response', type: 'text'}],
            timestamp: new Date().toISOString(),
            type: 'assistant',
          },
          {
            content: [{text: 'another', type: 'text'}],
            timestamp: new Date().toISOString(),
            type: 'user',
          },
        ],
        timestamp: 1_234_567_890,
        title: 'My Session',
        type: 'Claude',
      })

      sinon.stub(agent, 'execute').resolves('Success')
      sinon.stub(agent, 'deleteSession').resolves(true)

      const eventPayloads: unknown[] = []
      agent.agentEventBus?.on('cipher:cleanExternalSessionProcessed', (payload) => {
        eventPayloads.push(payload)
      })

      await agent.processCleanExternalSession(session)

      expect(eventPayloads).to.have.lengthOf(1)
      expect(eventPayloads[0]).to.deep.equal({
        codingAgent: 'Claude',
        externalSessionTitle: 'My Session',
      })
    })

    it('should clean up temporary internal session after processing', async () => {
      await agent.start()

      const session = createSampleCleanExternalSession()
      const deleteSessionStub = sinon.stub(agent, 'deleteSession').resolves(true)
      sinon.stub(agent, 'execute').resolves('Success')

      await agent.processCleanExternalSession(session)

      expect(deleteSessionStub.calledOnce).to.be.true
      const sessionIdArg = deleteSessionStub.firstCall.args[0]
      expect(sessionIdArg).to.match(/^test-session-123-process-\d+$/)
    })
  })

  describe('error handling', () => {
    it('should emit error event when processing fails', async () => {
      await agent.start()

      const session = createSampleCleanExternalSession({id: 'error-session'})
      const testError = new Error('Processing failed')
      sinon.stub(agent, 'execute').rejects(testError)
      sinon.stub(agent, 'deleteSession').resolves(true)

      const errorEventPayloads: unknown[] = []
      agent.agentEventBus?.on('cipher:cleanExternalSessionProcessingError', (payload) => {
        errorEventPayloads.push(payload)
      })

      await agent.processCleanExternalSession(session)

      expect(errorEventPayloads).to.have.lengthOf(1)
      expect(errorEventPayloads[0]).to.deep.equal({
        codingAgent: 'Claude',
        error: testError,
        externalSessionTitle: 'Test Session',
      })
    })

    it('should log error when processing fails', async () => {
      await agent.start()

      const session = createSampleCleanExternalSession({id: 'error-session-log'})
      const testError = new Error('Processing failed')
      sinon.stub(agent, 'execute').rejects(testError)
      sinon.stub(agent, 'deleteSession').resolves(true)

      await agent.processCleanExternalSession(session)

      expect(consoleErrorStub.calledOnce).to.be.true
      expect(consoleErrorStub.firstCall.args[0]).to.include('Error processing external session')
      expect(consoleErrorStub.firstCall.args[0]).to.include('error-session-log')
    })

    it('should not throw error when processing fails', async () => {
      await agent.start()

      const session = createSampleCleanExternalSession()
      sinon.stub(agent, 'execute').rejects(new Error('Processing failed'))
      sinon.stub(agent, 'deleteSession').resolves(true)
      // Should not throw
      await agent.processCleanExternalSession(session)
    })

    it('should clean up session even when processing fails', async () => {
      await agent.start()

      const session = createSampleCleanExternalSession()
      const deleteSessionStub = sinon.stub(agent, 'deleteSession').resolves(true)
      sinon.stub(agent, 'execute').rejects(new Error('Processing failed'))
      await agent.processCleanExternalSession(session)

      expect(deleteSessionStub.calledOnce).to.be.true
    })

    it('should log cleanup errors without throwing', async () => {
      await agent.start()

      const session = createSampleCleanExternalSession()
      sinon.stub(agent, 'execute').resolves('Success')
      sinon.stub(agent, 'deleteSession').rejects(new Error('Cleanup failed'))

      // Should not throw
      await agent.processCleanExternalSession(session)

      // Should log cleanup error (only once, since execute succeeded)
      expect(consoleErrorStub.calledOnce).to.be.true
      const cleanupError = consoleErrorStub.firstCall.args[0]
      expect(cleanupError).to.include('Error cleaning up processing session')
    })
  })

  describe('internal session ID generation', () => {
    it('should generate unique session IDs for each call', async () => {
      await agent.start()

      const session = createSampleCleanExternalSession()
      const executeStub = sinon.stub(agent, 'execute').resolves('Success')
      sinon.stub(agent, 'deleteSession').resolves(true)

      // Process same session twice
      await agent.processCleanExternalSession(session)
      await setTimeout(1)
      await agent.processCleanExternalSession(session)

      expect(executeStub.calledTwice).to.be.true
      const sessionId1 = executeStub.firstCall.args[1]
      const sessionId2 = executeStub.secondCall.args[1]

      expect(sessionId1).to.not.equal(sessionId2)
      expect(sessionId1).to.match(/^test-session-123-process-\d+$/)
      expect(sessionId2).to.match(/^test-session-123-process-\d+$/)
    })
  })

  describe('integration with different session types', () => {
    const sessionTypes = ['Claude', 'Cursor', 'Copilot', 'Codex'] as const

    for (const sessionType of sessionTypes) {
      it(`should process ${sessionType} sessions correctly`, async () => {
        await agent.start()

        const session = createSampleCleanExternalSession({
          title: `${sessionType} Test`,
          type: sessionType,
        })

        sinon.stub(agent, 'execute').resolves('Success')
        sinon.stub(agent, 'deleteSession').resolves(true)

        const successEventPayloads: {codingAgent: string; externalSessionTitle: string}[] = []
        agent.agentEventBus?.on('cipher:cleanExternalSessionProcessed', (payload) => {
          successEventPayloads.push(payload)
        })

        await agent.processCleanExternalSession(session)

        expect(successEventPayloads).to.have.lengthOf(1)
        expect(successEventPayloads[0].codingAgent).to.equal(sessionType)
        expect(successEventPayloads[0].externalSessionTitle).to.equal(`${sessionType} Test`)
      })
    }
  })

  describe('before agent start', () => {
    it('should throw error if called before agent.start()', async () => {
      const session = createSampleCleanExternalSession()

      try {
        await agent.processCleanExternalSession(session)
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.include('must be started')
      }
    })
  })
})
