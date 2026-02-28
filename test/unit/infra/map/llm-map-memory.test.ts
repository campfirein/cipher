import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {IContentGenerator} from '../../../../src/agent/core/interfaces/i-content-generator.js'

import {executeLlmMapMemory} from '../../../../src/agent/infra/map/llm-map-memory.js'

describe('executeLlmMapMemory', () => {
  let sandbox: SinonSandbox
  let mockGenerator: {estimateTokensSync: SinonStub; generateContent: SinonStub; generateContentStream: SinonStub}

  beforeEach(() => {
    sandbox = createSandbox()
    mockGenerator = {
      estimateTokensSync: sandbox.stub().returns(100),
      generateContent: sandbox.stub(),
      generateContentStream: sandbox.stub(),
    }
  })

  afterEach(() => {
    sandbox.restore()
  })

  it('should return empty results for empty items', async () => {
    const result = await executeLlmMapMemory({
      generator: mockGenerator as unknown as IContentGenerator,
      items: [],
      prompt: 'Extract facts',
    })

    expect(result.total).to.equal(0)
    expect(result.succeeded).to.equal(0)
    expect(result.failed).to.equal(0)
    expect(result.results).to.have.length(0)
  })

  it('should process items and return CurationFact arrays', async () => {
    mockGenerator.generateContent.resolves({
      content: JSON.stringify([
        {category: 'project', statement: 'Uses TypeScript', subject: 'tech-stack'},
        {category: 'convention', statement: 'Uses ESLint'},
      ]),
      finishReason: 'stop',
    })

    const result = await executeLlmMapMemory({
      generator: mockGenerator as unknown as IContentGenerator,
      items: [{chunk: 'some text', index: 0, totalChunks: 1}],
      prompt: 'Extract facts',
    })

    expect(result.total).to.equal(1)
    expect(result.succeeded).to.equal(1)
    expect(result.results[0]).to.have.length(2)
    expect(result.results[0]![0].statement).to.equal('Uses TypeScript')
    expect(result.results[0]![0].category).to.equal('project')
    expect(result.results[0]![0].subject).to.equal('tech-stack')
  })

  it('should normalize single object response to array', async () => {
    mockGenerator.generateContent.resolves({
      content: JSON.stringify({category: 'project', statement: 'Single fact'}),
      finishReason: 'stop',
    })

    const result = await executeLlmMapMemory({
      generator: mockGenerator as unknown as IContentGenerator,
      items: [{chunk: 'text', index: 0}],
      prompt: 'Extract',
    })

    expect(result.succeeded).to.equal(1)
    expect(result.results[0]).to.have.length(1)
    expect(result.results[0]![0].statement).to.equal('Single fact')
  })

  it('should normalize invalid categories to undefined', async () => {
    mockGenerator.generateContent.resolves({
      content: JSON.stringify([
        {category: 'unknown_thing', statement: 'Fact with bad category'},
        {category: 'project', statement: 'Fact with good category'},
      ]),
      finishReason: 'stop',
    })

    const result = await executeLlmMapMemory({
      generator: mockGenerator as unknown as IContentGenerator,
      items: [{chunk: 'text'}],
      prompt: 'Extract',
    })

    expect(result.results[0]![0].category).to.equal(undefined)
    expect(result.results[0]![1].category).to.equal('project')
  })

  it('should accept empty arrays as valid (non-informational chunks)', async () => {
    mockGenerator.generateContent.resolves({
      content: JSON.stringify([]),
      finishReason: 'stop',
    })

    const result = await executeLlmMapMemory({
      generator: mockGenerator as unknown as IContentGenerator,
      items: [{chunk: 'text with no extractable facts'}],
      prompt: 'Extract',
    })

    expect(result.succeeded).to.equal(1)
    expect(result.failed).to.equal(0)
    expect(result.results[0]).to.have.length(0)
    // Should NOT have retried — empty array is valid
    expect(mockGenerator.generateContent.callCount).to.equal(1)
  })

  it('should retry when all items in a non-empty array are malformed', async () => {
    mockGenerator.generateContent
      .onFirstCall().resolves({content: JSON.stringify([{foo: 'bar'}, {baz: 123}]), finishReason: 'stop'})
      .onSecondCall().resolves({content: JSON.stringify([{statement: 'Fixed fact'}]), finishReason: 'stop'})

    const result = await executeLlmMapMemory({
      generator: mockGenerator as unknown as IContentGenerator,
      items: [{chunk: 'text'}],
      maxAttempts: 3,
      prompt: 'Extract',
    })

    expect(result.succeeded).to.equal(1)
    expect(result.results[0]![0].statement).to.equal('Fixed fact')
    // Should have retried once — all-malformed triggers retry
    expect(mockGenerator.generateContent.callCount).to.equal(2)
  })

  it('should filter facts with empty or missing statements', async () => {
    mockGenerator.generateContent.resolves({
      content: JSON.stringify([
        {statement: 'Valid fact'},
        {statement: ''},
        {statement: '   '},
        {category: 'project'},
      ]),
      finishReason: 'stop',
    })

    const result = await executeLlmMapMemory({
      generator: mockGenerator as unknown as IContentGenerator,
      items: [{chunk: 'text'}],
      prompt: 'Extract',
    })

    expect(result.results[0]).to.have.length(1)
    expect(result.results[0]![0].statement).to.equal('Valid fact')
  })

  it('should handle per-item failures gracefully', async () => {
    mockGenerator.generateContent
      .onFirstCall().resolves({content: JSON.stringify([{statement: 'Fact 1'}]), finishReason: 'stop'})
      .onSecondCall().rejects(new Error('LLM error'))
      .onThirdCall().resolves({content: JSON.stringify([{statement: 'Fact 3'}]), finishReason: 'stop'})

    const result = await executeLlmMapMemory({
      generator: mockGenerator as unknown as IContentGenerator,
      items: [{chunk: 'a'}, {chunk: 'b'}, {chunk: 'c'}],
      maxAttempts: 1,
      prompt: 'Extract',
    })

    expect(result.total).to.equal(3)
    expect(result.succeeded).to.equal(2)
    expect(result.failed).to.equal(1)
    expect(result.results[0]).to.not.equal(null)
    expect(result.results[1]).to.equal(null)
    expect(result.results[2]).to.not.equal(null)
  })

  it('should return results in input order', async () => {
    // Make later items resolve first by using different delay patterns
    mockGenerator.generateContent.callsFake(async (request: {contents: Array<{content: string}>}) => {
      const {content} = request.contents[0]
      const indexMatch = /item_index.*?(\d+)/s.exec(content)
      const index = indexMatch ? Number.parseInt(indexMatch[1], 10) : 0

      return {
        content: JSON.stringify([{statement: `Fact from item ${index}`}]),
        finishReason: 'stop',
      }
    })

    const result = await executeLlmMapMemory({
      generator: mockGenerator as unknown as IContentGenerator,
      items: [{chunk: 'a'}, {chunk: 'b'}, {chunk: 'c'}],
      prompt: 'Extract',
    })

    expect(result.results).to.have.length(3)
    expect(result.results[0]![0].statement).to.equal('Fact from item 0')
    expect(result.results[1]![0].statement).to.equal('Fact from item 1')
    expect(result.results[2]![0].statement).to.equal('Fact from item 2')
  })

  it('should pass taskId to generateContent', async () => {
    mockGenerator.generateContent.resolves({
      content: JSON.stringify([{statement: 'fact'}]),
      finishReason: 'stop',
    })

    await executeLlmMapMemory({
      generator: mockGenerator as unknown as IContentGenerator,
      items: [{chunk: 'text'}],
      prompt: 'Extract',
      taskId: 'test-task-123',
    })

    const callArgs = mockGenerator.generateContent.firstCall.args[0]
    expect(callArgs.taskId).to.equal('test-task-123')
  })

  it('should retry on invalid JSON and succeed', async () => {
    mockGenerator.generateContent
      .onFirstCall().resolves({content: 'not json at all', finishReason: 'stop'})
      .onSecondCall().resolves({content: JSON.stringify([{statement: 'Fixed'}]), finishReason: 'stop'})

    const result = await executeLlmMapMemory({
      generator: mockGenerator as unknown as IContentGenerator,
      items: [{chunk: 'text'}],
      maxAttempts: 3,
      prompt: 'Extract',
    })

    expect(result.succeeded).to.equal(1)
    expect(result.results[0]![0].statement).to.equal('Fixed')
    expect(mockGenerator.generateContent.callCount).to.equal(2)
  })
})
