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

  it('dedups duplicate contextPath inputs, keeping the last item content (most recent state)', async () => {
    // Capture the prompt the model receives so we can assert it carries the
    // LATEST content (v2), not the older content (v1) for a duplicated path.
    let capturedAbstractPrompt = ''
    const generator: IContentGenerator = {
      estimateTokensSync: () => 10,
      generateContent: sandbox.stub().rejects(new Error('n/a')),
      generateContentStream: sandbox.stub().callsFake(async function *(req: {
        contents?: Array<{content?: string}>
        systemPrompt?: string
      }) {
        const userContent = req.contents?.[0]?.content ?? ''
        const isAbstract = (req.systemPrompt ?? '').includes('one-line')
        if (isAbstract) capturedAbstractPrompt = userContent
        const innerTag = isAbstract ? 'abstract' : 'overview'
        yield {content: `<file path="auth/jwt.md"><${innerTag}>S</${innerTag}></file>`, isComplete: false}
        yield {isComplete: true}
      }),
    } as unknown as IContentGenerator

    const result = await generateFileAbstractsBatch(
      [
        {contextPath: 'auth/jwt.md', fullContent: 'v1: original draft'},
        {contextPath: 'auth/jwt.md', fullContent: 'v2: updated content'},
      ],
      generator,
    )

    // Only one `<file path="auth/jwt.md">` block should appear in the prompt
    // (deduped at the generator boundary). Without the dedup, the model would
    // see two blocks and may answer them in either order.
    const pathOccurrences = (capturedAbstractPrompt.match(/<file\s+path="auth\/jwt\.md"/g) ?? []).length
    expect(pathOccurrences).to.equal(1, 'duplicate paths must collapse to a single prompt block')

    // The deduped content must be the LATEST one (v2) — disk file reflects v2.
    expect(capturedAbstractPrompt).to.include('v2: updated content')
    expect(capturedAbstractPrompt).to.not.include('v1: original draft')

    // Result returns ONE entry per ORIGINAL input (callers expect array
    // alignment with the queue items they passed in).
    expect(result).to.have.lengthOf(2)
    expect(result[0].contextPath).to.equal('auth/jwt.md')
    expect(result[1].contextPath).to.equal('auth/jwt.md')
    expect(result[0].abstractContent).to.equal('S')
    expect(result[1].abstractContent).to.equal('S')
  })

  it('CDATA-wraps file content so XML/HTML markers in the body cannot break the envelope', async () => {
    // Capture BOTH the L0 and L1 prompts so we assert the wrap is applied to
    // each independent builder. Without separate captures, we'd only validate
    // the last call's prompt — a future refactor that forgot wrapCdata in one
    // builder would slip past.
    const capturedPrompts: {abstract?: string; overview?: string} = {}
    const generator: IContentGenerator = {
      estimateTokensSync: () => 10,
      generateContent: sandbox.stub().rejects(new Error('n/a')),
      generateContentStream: sandbox.stub().callsFake(async function *(req: {
        contents?: Array<{content?: string}>
        systemPrompt?: string
      }) {
        const isAbstract = (req.systemPrompt ?? '').includes('one-line')
        if (isAbstract) capturedPrompts.abstract = req.contents?.[0]?.content ?? ''
        else capturedPrompts.overview = req.contents?.[0]?.content ?? ''
        const innerTag = isAbstract ? 'abstract' : 'overview'
        yield {content: `<file path="docs/xml.md"><${innerTag}>OK</${innerTag}></file>`, isComplete: false}
        yield {isComplete: true}
      }),
    } as unknown as IContentGenerator

    // Content that would break the prompt envelope without CDATA: literal
    // </document> and </file> markers, plus an XML-flavored payload.
    const treacherousContent = 'A doc explaining the </document> tag and </file>: <foo>bar</foo>'

    const result = await generateFileAbstractsBatch(
      [{contextPath: 'docs/xml.md', fullContent: treacherousContent}],
      generator,
    )

    // Both prompts (L0 and L1) must independently wrap content in CDATA.
    for (const [label, prompt] of [['abstract', capturedPrompts.abstract], ['overview', capturedPrompts.overview]] as const) {
      expect(prompt, `${label} prompt was captured`).to.be.a('string')
      const promptText = prompt ?? ''
      expect(promptText, `${label} prompt opens CDATA`).to.include('<![CDATA[')
      expect(promptText, `${label} prompt closes CDATA`).to.include(']]>')
      // Exactly one structural <document> opener per file (the body's literal
      // </document> is now inert inside CDATA).
      const docOpen = (promptText.match(/<document>/g) ?? []).length
      expect(docOpen, `${label} prompt has exactly one <document> envelope`).to.equal(1)
    }

    // Result still parses cleanly.
    expect(result[0].abstractContent).to.equal('OK')
  })

  it('parser is robust to a literal </file> appearing inside the model overview prose', async () => {
    // The model output is plain text (NOT CDATA-wrapped). A document about
    // build systems / XML / JSX may legitimately produce overview prose like
    // "the </file> closing tag in Ant build files…" — a closer-anchored
    // parser would stop at the premature </file> and orphan the inner tag.
    const l0Response = '<file path="ant.md"><abstract>Ant build files use a closing </file> tag.</abstract></file>'
    const l1Response = `<file path="ant.md"><overview>
- Mentions the </file> closing tag in build prose
- Still must round-trip cleanly
</overview></file>`

    const generator = makeScriptedGenerator(sandbox, [l0Response, l1Response])
    const result = await generateFileAbstractsBatch(
      [{contextPath: 'ant.md', fullContent: 'Ant build files'}],
      generator,
    )

    // Both fields are populated despite the literal </file> in the body —
    // the parser anchors on `<file path>` openers, not `</file>` closers.
    expect(result).to.have.lengthOf(1)
    expect(result[0].abstractContent).to.include('Ant build files')
    expect(result[0].abstractContent).to.include('</file>')
    expect(result[0].overviewContent).to.include('Mentions the </file>')
    expect(result[0].overviewContent).to.include('Still must round-trip cleanly')
  })

  it('escapes nested CDATA terminators in content so the wrap stays valid', async () => {
    let capturedPrompt = ''
    const generator: IContentGenerator = {
      estimateTokensSync: () => 10,
      generateContent: sandbox.stub().rejects(new Error('n/a')),
      generateContentStream: sandbox.stub().callsFake(async function *(req: {
        contents?: Array<{content?: string}>
      }) {
        capturedPrompt = req.contents?.[0]?.content ?? ''
        yield {content: '<file path="x.md"><abstract>OK</abstract></file>', isComplete: false}
        yield {isComplete: true}
      }),
    } as unknown as IContentGenerator

    // Content that contains a literal `]]>` sequence — would terminate CDATA
    // prematurely without the in-CDATA escape trick.
    await generateFileAbstractsBatch(
      [{contextPath: 'x.md', fullContent: 'before ]]> after'}],
      generator,
    )

    // The bare `]]>` must NOT appear inside the still-active CDATA section —
    // it should be split via `]]]]><![CDATA[>`.
    expect(capturedPrompt).to.include(']]]]><![CDATA[>')
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
