import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {IContentGenerator} from '../../../../src/agent/core/interfaces/i-content-generator.js'
import type {IFileSystem} from '../../../../src/agent/core/interfaces/i-file-system.js'

import {type CurationFact} from '../../../../src/agent/infra/sandbox/curation-helpers.js'
import {createToolsSDK} from '../../../../src/agent/infra/sandbox/tools-sdk.js'

describe('tools.curation.mapExtract', () => {
  let sandbox: SinonSandbox
  let mockGenerator: {estimateTokensSync: SinonStub; generateContent: SinonStub; generateContentStream: SinonStub}
  let mockFileSystem: IFileSystem

  beforeEach(() => {
    sandbox = createSandbox()
    mockGenerator = {
      estimateTokensSync: sandbox.stub().returns(100),
      generateContent: sandbox.stub(),
      generateContentStream: sandbox.stub(),
    }
    // Minimal mock file system (required by createToolsSDK)
    mockFileSystem = {
      glob: sandbox.stub(),
      grep: sandbox.stub(),
      listDirectory: sandbox.stub(),
      readFile: sandbox.stub(),
      writeFile: sandbox.stub(),
    } as unknown as IFileSystem
  })

  afterEach(() => {
    sandbox.restore()
  })

  it('should throw when commandType is not curate', async () => {
    const sdk = createToolsSDK({
      commandType: 'query',
      contentGenerator: mockGenerator as unknown as IContentGenerator,
      fileSystem: mockFileSystem,
    })

    try {
      await sdk.curation.mapExtract('some context', {prompt: 'Extract facts'})
      expect.fail('Should have thrown')
    } catch (error: unknown) {
      expect((error as Error).message).to.equal('mapExtract only available in curate mode')
    }
  })

  it('should throw when commandType is undefined', async () => {
    const sdk = createToolsSDK({
      contentGenerator: mockGenerator as unknown as IContentGenerator,
      fileSystem: mockFileSystem,
    })

    try {
      await sdk.curation.mapExtract('some context', {prompt: 'Extract facts'})
      expect.fail('Should have thrown')
    } catch (error: unknown) {
      expect((error as Error).message).to.equal('mapExtract only available in curate mode')
    }
  })

  it('should throw when content generator is not configured', async () => {
    const sdk = createToolsSDK({
      commandType: 'curate',
      fileSystem: mockFileSystem,
    })

    try {
      await sdk.curation.mapExtract('some context', {prompt: 'Extract facts'})
      expect.fail('Should have thrown')
    } catch (error: unknown) {
      expect((error as Error).message).to.include('no content generator configured')
    }
  })

  it('should chunk context and return result with facts and metadata', async () => {
    mockGenerator.generateContent.resolves({
      content: JSON.stringify([
        {category: 'project', statement: 'Uses TypeScript', subject: 'tech-stack'},
      ]),
      finishReason: 'stop',
    })

    const sdk = createToolsSDK({
      commandType: 'curate',
      contentGenerator: mockGenerator as unknown as IContentGenerator,
      fileSystem: mockFileSystem,
    })

    const result = await sdk.curation.mapExtract('Some short context text', {prompt: 'Extract facts'})

    expect(result.facts).to.be.an('array')
    expect(result.facts.length).to.be.greaterThan(0)
    expect(result.facts[0].statement).to.equal('Uses TypeScript')
    expect(result.facts[0].category).to.equal('project')
    expect(result.facts[0].subject).to.equal('tech-stack')
    expect(result.succeeded).to.equal(1)
    expect(result.failed).to.equal(0)
    expect(result.total).to.equal(1)
  })

  it('should handle empty context', async () => {
    const sdk = createToolsSDK({
      commandType: 'curate',
      contentGenerator: mockGenerator as unknown as IContentGenerator,
      fileSystem: mockFileSystem,
    })

    const result = await sdk.curation.mapExtract('', {prompt: 'Extract facts'})

    expect(result.facts).to.be.an('array')
    expect(result.facts).to.have.length(0)
    expect(result.total).to.equal(0)
  })

  it('should filter malformed LLM outputs', async () => {
    mockGenerator.generateContent.resolves({
      content: JSON.stringify([
        {category: 'project', statement: 'Valid fact'},
        {category: 'project', statement: ''},
        {category: 'project'},
        {statement: 123},
        {category: 'project', statement: 'Another valid fact'},
      ]),
      finishReason: 'stop',
    })

    const sdk = createToolsSDK({
      commandType: 'curate',
      contentGenerator: mockGenerator as unknown as IContentGenerator,
      fileSystem: mockFileSystem,
    })

    const result = await sdk.curation.mapExtract('Some context text', {prompt: 'Extract facts'})

    const statements = result.facts.map((f: CurationFact) => f.statement)
    expect(statements).to.include('Valid fact')
    expect(statements).to.include('Another valid fact')
    expect(result.facts.every((f: CurationFact) => typeof f.statement === 'string' && f.statement.trim().length > 0)).to.equal(true)
  })

  it('should accept explicit taskId parameter', async () => {
    mockGenerator.generateContent.resolves({
      content: JSON.stringify([{statement: 'fact'}]),
      finishReason: 'stop',
    })

    const sdk = createToolsSDK({
      commandType: 'curate',
      contentGenerator: mockGenerator as unknown as IContentGenerator,
      fileSystem: mockFileSystem,
    })

    await sdk.curation.mapExtract('Some context text', {
      prompt: 'Extract facts',
      taskId: 'test-task-456',
    })

    const callArgs = mockGenerator.generateContent.firstCall.args[0]
    expect(callArgs.taskId).to.equal('test-task-456')
  })

  it('should normalize invalid categories to undefined', async () => {
    mockGenerator.generateContent.resolves({
      content: JSON.stringify([
        {category: 'invalid_category', statement: 'Fact with bad category'},
        {category: 'project', statement: 'Fact with good category'},
      ]),
      finishReason: 'stop',
    })

    const sdk = createToolsSDK({
      commandType: 'curate',
      contentGenerator: mockGenerator as unknown as IContentGenerator,
      fileSystem: mockFileSystem,
    })

    const result = await sdk.curation.mapExtract('Some context text', {prompt: 'Extract facts'})

    const badCatFact = result.facts.find((f: CurationFact) => f.statement === 'Fact with bad category')
    const goodCatFact = result.facts.find((f: CurationFact) => f.statement === 'Fact with good category')

    expect(badCatFact).to.not.equal(undefined)
    expect(badCatFact!.category).to.equal(undefined)
    expect(goodCatFact).to.not.equal(undefined)
    expect(goodCatFact!.category).to.equal('project')
  })

  it('should surface failure metadata for partial chunk failures', async () => {
    const largeContext = 'A'.repeat(20_000)

    mockGenerator.generateContent
      .onFirstCall().resolves({content: JSON.stringify([{statement: 'Fact from chunk 1'}]), finishReason: 'stop'})
      .onSecondCall().rejects(new Error('LLM error'))
      .onThirdCall().resolves({content: JSON.stringify([{statement: 'Fact from chunk 3'}]), finishReason: 'stop'})

    const sdk = createToolsSDK({
      commandType: 'curate',
      contentGenerator: mockGenerator as unknown as IContentGenerator,
      fileSystem: mockFileSystem,
    })

    const result = await sdk.curation.mapExtract(largeContext, {
      chunkSize: 8000,
      prompt: 'Extract facts',
    })

    expect(result.facts).to.be.an('array')
    expect(result.facts.length).to.be.greaterThan(0)
    expect(result.failed).to.be.greaterThan(0)
    expect(result.succeeded).to.be.greaterThan(0)
    expect(result.total).to.equal(result.succeeded + result.failed)
  })

  it('should throw when all chunks fail', async () => {
    mockGenerator.generateContent.rejects(new Error('LLM error'))

    const sdk = createToolsSDK({
      commandType: 'curate',
      contentGenerator: mockGenerator as unknown as IContentGenerator,
      fileSystem: mockFileSystem,
    })

    try {
      await sdk.curation.mapExtract('Some context text', {prompt: 'Extract facts'})
      expect.fail('Should have thrown')
    } catch (error: unknown) {
      expect((error as Error).message).to.include('all')
      expect((error as Error).message).to.include('failed')
    }
  })
})
