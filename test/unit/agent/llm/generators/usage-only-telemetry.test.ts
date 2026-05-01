import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {
  GenerateContentRequest,
  GenerateContentResponse,
  IContentGenerator,
} from '../../../../../src/agent/core/interfaces/i-content-generator.js'

import {AgentEventBus} from '../../../../../src/agent/infra/events/event-emitter.js'
import {wrapWithUsageOnlyTelemetry} from '../../../../../src/agent/infra/llm/generators/usage-only-telemetry.js'

describe('wrapWithUsageOnlyTelemetry', () => {
  let sandbox: SinonSandbox
  let agentBus: AgentEventBus
  let mockGenerator: {
    estimateTokensSync: SinonStub
    generateContent: SinonStub
    generateContentStream: SinonStub
  }
  const request: GenerateContentRequest = {
    config: {temperature: 0},
    contents: [{content: 'hi', role: 'user'}],
    model: 'm',
    taskId: 't1',
  }
  const response: GenerateContentResponse = {
    content: 'ok',
    finishReason: 'stop',
    usage: {inputTokens: 10, outputTokens: 5, totalTokens: 15},
  }

  beforeEach(() => {
    sandbox = createSandbox()
    agentBus = new AgentEventBus()
    mockGenerator = {
      estimateTokensSync: sandbox.stub().returns(0),
      generateContent: sandbox.stub().resolves(response),
      generateContentStream: sandbox.stub(),
    }
  })

  afterEach(() => {
    sandbox.restore()
  })

  it('forwards llmservice:usage to the agent bus tagged with the supplied sessionId', async () => {
    const usageSpy = sandbox.spy()
    agentBus.on('llmservice:usage', usageSpy)

    const wrapped = wrapWithUsageOnlyTelemetry({
      agentEventBus: agentBus,
      inner: mockGenerator as unknown as IContentGenerator,
      sessionTag: 'abstract-queue-bg',
    })
    await wrapped.generateContent(request)

    expect(usageSpy.calledOnce).to.be.true
    const payload = usageSpy.firstCall.args[0] as Record<string, unknown>
    expect(payload.sessionId).to.equal('abstract-queue-bg')
    expect(payload.inputTokens).to.equal(10)
    expect(payload.outputTokens).to.equal(5)
    expect(payload.totalTokens).to.equal(15)
    expect(payload.taskId).to.equal('t1')
  })

  it('does NOT emit llmservice:thinking on the agent bus', async () => {
    const thinkingSpy = sandbox.spy()
    agentBus.on('llmservice:thinking', thinkingSpy)

    const wrapped = wrapWithUsageOnlyTelemetry({
      agentEventBus: agentBus,
      inner: mockGenerator as unknown as IContentGenerator,
      sessionTag: 's',
    })
    await wrapped.generateContent(request)

    expect(thinkingSpy.called).to.be.false
  })

  it('does NOT emit llmservice:error on the agent bus when inner throws (but re-throws)', async () => {
    const errorSpy = sandbox.spy()
    agentBus.on('llmservice:error', errorSpy)
    mockGenerator.generateContent.rejects(new Error('boom'))

    const wrapped = wrapWithUsageOnlyTelemetry({
      agentEventBus: agentBus,
      inner: mockGenerator as unknown as IContentGenerator,
      sessionTag: 's',
    })

    let thrown: unknown
    try {
      await wrapped.generateContent(request)
    } catch (error) {
      thrown = error
    }

    expect(thrown).to.be.instanceOf(Error)
    expect((thrown as Error).message).to.equal('boom')
    expect(errorSpy.called).to.be.false
  })

  it('delegates estimateTokensSync to the inner generator', () => {
    mockGenerator.estimateTokensSync.returns(42)

    const wrapped = wrapWithUsageOnlyTelemetry({
      agentEventBus: agentBus,
      inner: mockGenerator as unknown as IContentGenerator,
      sessionTag: 's',
    })

    expect(wrapped.estimateTokensSync('hello')).to.equal(42)
    expect(mockGenerator.estimateTokensSync.calledOnceWithExactly('hello')).to.be.true
  })
})
