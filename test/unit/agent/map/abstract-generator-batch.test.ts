import {expect} from 'chai'
import {createSandbox, type SinonSandbox} from 'sinon'

import type {IContentGenerator} from '../../../../src/agent/core/interfaces/i-content-generator.js'

import {generateFileAbstractsBatch} from '../../../../src/agent/infra/map/abstract-generator.js'

/**
 * Build a generator whose generateContentStream yields a fixed text response
 * the n-th time it's called. Useful for stubbing the parallel L0/L1 batch
 * calls with two distinct texts.
 */
function makeScriptedGenerator(sandbox: SinonSandbox, responsesByCall: string[]): IContentGenerator {
  let callIndex = 0
  return {
    estimateTokensSync: () => 10,
    generateContent: sandbox.stub().rejects(new Error('n/a')),
    generateContentStream: sandbox.stub().callsFake(async function *() {
      const text = responsesByCall[callIndex++] ?? ''
      yield {content: text, isComplete: false}
      yield {isComplete: true}
    }),
  } as unknown as IContentGenerator
}

describe('generateFileAbstractsBatch', () => {
  const sandbox = createSandbox()

  afterEach(() => sandbox.restore())

  it('returns one result per input file when the model responds with all paths', async () => {
    const l0Response = [
      '<file path="a.md"><abstract>One-line summary of A.</abstract></file>',
      '<file path="b.md"><abstract>One-line summary of B.</abstract></file>',
    ].join('\n')
    const l1Response = [
      '<file path="a.md"><overview>- bullet 1\n- bullet 2\n- bullet 3</overview></file>',
      '<file path="b.md"><overview>- bullet 1\n- bullet 2</overview></file>',
    ].join('\n')

    const generator = makeScriptedGenerator(sandbox, [l0Response, l1Response])
    const result = await generateFileAbstractsBatch(
      [
        {contextPath: 'a.md', fullContent: 'content of A'},
        {contextPath: 'b.md', fullContent: 'content of B'},
      ],
      generator,
    )

    expect(result).to.have.lengthOf(2)
    expect(result[0].contextPath).to.equal('a.md')
    expect(result[0].abstractContent).to.equal('One-line summary of A.')
    expect(result[0].overviewContent).to.contain('bullet 1')
    expect(result[1].contextPath).to.equal('b.md')
    expect(result[1].abstractContent).to.equal('One-line summary of B.')
  })

  it('keeps input order when the model returns paths out of order', async () => {
    const l0Response = [
      '<file path="b.md"><abstract>B summary.</abstract></file>',
      '<file path="a.md"><abstract>A summary.</abstract></file>',
    ].join('\n')
    const l1Response = [
      '<file path="b.md"><overview>B over.</overview></file>',
      '<file path="a.md"><overview>A over.</overview></file>',
    ].join('\n')

    const generator = makeScriptedGenerator(sandbox, [l0Response, l1Response])
    const result = await generateFileAbstractsBatch(
      [
        {contextPath: 'a.md', fullContent: 'A'},
        {contextPath: 'b.md', fullContent: 'B'},
      ],
      generator,
    )

    expect(result.map((r: {contextPath: string}) => r.contextPath)).to.deep.equal(['a.md', 'b.md'])
    expect(result[0].abstractContent).to.equal('A summary.')
    expect(result[1].abstractContent).to.equal('B summary.')
  })

  it('returns empty strings for files the model omits', async () => {
    const l0Response = '<file path="a.md"><abstract>Only A.</abstract></file>'
    const l1Response = '<file path="a.md"><overview>Only A over.</overview></file>'

    const generator = makeScriptedGenerator(sandbox, [l0Response, l1Response])
    const result = await generateFileAbstractsBatch(
      [
        {contextPath: 'a.md', fullContent: 'A'},
        {contextPath: 'b.md', fullContent: 'B'},
      ],
      generator,
    )

    expect(result).to.have.lengthOf(2)
    expect(result[0].abstractContent).to.equal('Only A.')
    expect(result[1].abstractContent).to.equal('')
    expect(result[1].overviewContent).to.equal('')
  })

  it('returns empty strings when the model output is malformed (no matching tags)', async () => {
    const generator = makeScriptedGenerator(sandbox, ['random unparseable text', 'also unparseable'])
    const result = await generateFileAbstractsBatch(
      [
        {contextPath: 'a.md', fullContent: 'A'},
      ],
      generator,
    )

    expect(result).to.have.lengthOf(1)
    expect(result[0].abstractContent).to.equal('')
    expect(result[0].overviewContent).to.equal('')
  })

  it('issues exactly two LLM calls regardless of batch size (one L0 batch, one L1 batch)', async () => {
    const l0Response = Array.from({length: 5}, (_, i) =>
      `<file path="${i}.md"><abstract>S${i}.</abstract></file>`,
    ).join('\n')
    const l1Response = Array.from({length: 5}, (_, i) =>
      `<file path="${i}.md"><overview>O${i}.</overview></file>`,
    ).join('\n')

    const generator = makeScriptedGenerator(sandbox, [l0Response, l1Response])
    await generateFileAbstractsBatch(
      Array.from({length: 5}, (_, i) => ({contextPath: `${i}.md`, fullContent: `c${i}`})),
      generator,
    )

    const stubbed = generator.generateContentStream as ReturnType<typeof sandbox.stub>
    expect(stubbed.callCount).to.equal(2)
  })
})
