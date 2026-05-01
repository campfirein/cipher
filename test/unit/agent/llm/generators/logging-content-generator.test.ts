import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {
  GenerateContentChunk,
  GenerateContentRequest,
  GenerateContentResponse,
  IContentGenerator,
} from '../../../../../src/agent/core/interfaces/i-content-generator.js'

import {SessionEventBus} from '../../../../../src/agent/infra/events/event-emitter.js'
import {LoggingContentGenerator} from '../../../../../src/agent/infra/llm/generators/logging-content-generator.js'

async function* makeChunks(): AsyncGenerator<GenerateContentChunk> {
  yield {content: 'hello', isComplete: false}
  yield {
    finishReason: 'stop',
    isComplete: true,
    usage: {inputTokens: 7, outputTokens: 2, totalTokens: 9},
  }
}

async function drain(stream: AsyncGenerator<GenerateContentChunk>): Promise<GenerateContentChunk[]> {
  const collected: GenerateContentChunk[] = []
  for await (const chunk of stream) {
    collected.push(chunk)
  }

  return collected
}

describe('LoggingContentGenerator', () => {
  let sandbox: SinonSandbox
  let mockGenerator: {
    estimateTokensSync: SinonStub
    generateContent: SinonStub
    generateContentStream: SinonStub
  }
  let bus: SessionEventBus
  const baseRequest: GenerateContentRequest = {
    config: {temperature: 0},
    contents: [{content: 'hi', role: 'user'}],
    model: 'm',
    taskId: 't1',
  }
  const baseResponse: GenerateContentResponse = {
    content: 'ok',
    finishReason: 'stop',
    usage: {inputTokens: 10, outputTokens: 5, totalTokens: 15},
  }

  beforeEach(() => {
    sandbox = createSandbox()
    bus = new SessionEventBus()
    mockGenerator = {
      estimateTokensSync: sandbox.stub().returns(0),
      generateContent: sandbox.stub().resolves(baseResponse),
      generateContentStream: sandbox.stub(),
    }
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('default mode (usageOnly omitted/false)', () => {
    it('emits llmservice:thinking on generateContent', async () => {
      const thinkingSpy = sandbox.spy()
      bus.on('llmservice:thinking', thinkingSpy)

      const sut = new LoggingContentGenerator(mockGenerator as unknown as IContentGenerator, bus)
      await sut.generateContent(baseRequest)

      expect(thinkingSpy.calledOnce).to.be.true
    })

    it('emits llmservice:error when inner throws', async () => {
      const errorSpy = sandbox.spy()
      bus.on('llmservice:error', errorSpy)
      mockGenerator.generateContent.rejects(new Error('boom'))

      const sut = new LoggingContentGenerator(mockGenerator as unknown as IContentGenerator, bus)
      let thrown: unknown
      try {
        await sut.generateContent(baseRequest)
      } catch (error) {
        thrown = error
      }

      expect(thrown).to.be.instanceOf(Error)
      expect(errorSpy.calledOnce).to.be.true
      expect(errorSpy.firstCall.args[0]).to.deep.equal({error: 'boom'})
    })

    it('emits llmservice:usage on generateContent when inner returns usage', async () => {
      const usageSpy = sandbox.spy()
      bus.on('llmservice:usage', usageSpy)

      const sut = new LoggingContentGenerator(mockGenerator as unknown as IContentGenerator, bus)
      await sut.generateContent(baseRequest)

      expect(usageSpy.calledOnce).to.be.true
      const payload = usageSpy.firstCall.args[0] as Record<string, unknown>
      expect(payload.inputTokens).to.equal(10)
      expect(payload.outputTokens).to.equal(5)
      expect(payload.totalTokens).to.equal(15)
      expect(payload.taskId).to.equal('t1')
      expect(payload.model).to.equal('m')
    })
  })

  describe('usageOnly: true', () => {
    it('suppresses llmservice:thinking on generateContent', async () => {
      const thinkingSpy = sandbox.spy()
      bus.on('llmservice:thinking', thinkingSpy)

      const sut = new LoggingContentGenerator(
        mockGenerator as unknown as IContentGenerator,
        bus,
        {usageOnly: true},
      )
      await sut.generateContent(baseRequest)

      expect(thinkingSpy.called).to.be.false
    })

    it('suppresses llmservice:error when inner throws (but still re-throws)', async () => {
      const errorSpy = sandbox.spy()
      bus.on('llmservice:error', errorSpy)
      mockGenerator.generateContent.rejects(new Error('boom'))

      const sut = new LoggingContentGenerator(
        mockGenerator as unknown as IContentGenerator,
        bus,
        {usageOnly: true},
      )

      let thrown: unknown
      try {
        await sut.generateContent(baseRequest)
      } catch (error) {
        thrown = error
      }

      expect(thrown).to.be.instanceOf(Error)
      expect((thrown as Error).message).to.equal('boom')
      expect(errorSpy.called).to.be.false
    })

    it('still emits llmservice:usage on generateContent', async () => {
      const usageSpy = sandbox.spy()
      bus.on('llmservice:usage', usageSpy)

      const sut = new LoggingContentGenerator(
        mockGenerator as unknown as IContentGenerator,
        bus,
        {usageOnly: true},
      )
      await sut.generateContent(baseRequest)

      expect(usageSpy.calledOnce).to.be.true
    })

    it('suppresses llmservice:thinking on generateContentStream', async () => {
      const thinkingSpy = sandbox.spy()
      bus.on('llmservice:thinking', thinkingSpy)

      mockGenerator.generateContentStream.returns(makeChunks())

      const sut = new LoggingContentGenerator(
        mockGenerator as unknown as IContentGenerator,
        bus,
        {usageOnly: true},
      )
      await drain(sut.generateContentStream(baseRequest))

      expect(thinkingSpy.called).to.be.false
    })

    it('still emits llmservice:usage on generateContentStream final-chunk usage', async () => {
      const usageSpy = sandbox.spy()
      bus.on('llmservice:usage', usageSpy)

      mockGenerator.generateContentStream.returns(makeChunks())

      const sut = new LoggingContentGenerator(
        mockGenerator as unknown as IContentGenerator,
        bus,
        {usageOnly: true},
      )
      await drain(sut.generateContentStream(baseRequest))

      expect(usageSpy.calledOnce).to.be.true
      const payload = usageSpy.firstCall.args[0] as Record<string, unknown>
      expect(payload.inputTokens).to.equal(7)
      expect(payload.totalTokens).to.equal(9)
    })
  })
})
