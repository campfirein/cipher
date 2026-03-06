import {expect} from 'chai'

import {
  chunk,
  type CurationFact,
  dedup,
  detectMessageBoundaries,
  groupBySubject,
  recon,
  recordProgress,
  SINGLE_PASS_CHAR_THRESHOLD,
} from '../../../../src/agent/infra/sandbox/curation-helpers.js'

describe('curation-helpers', () => {
  // -----------------------------------------------------------------------
  // recon
  // -----------------------------------------------------------------------
  describe('recon()', () => {
    it('should return correct metadata from context', () => {
      const context = 'Line 1\nLine 2\nLine 3'
      const meta = {}
      const history = {entries: [], totalProcessed: 0}

      const result = recon(context, meta, history)

      expect(result.meta.charCount).to.equal(context.length)
      expect(result.meta.lineCount).to.equal(3)
      expect(result.meta.messageCount).to.equal(0)
    })

    it('should count message boundaries', () => {
      const context = 'Hello\n\n[USER]: Hi\n\n[ASSISTANT]: Hello there'
      const result = recon(context, {}, {entries: [], totalProcessed: 0})

      expect(result.meta.messageCount).to.equal(2)
    })

    it('should recommend single-pass for small contexts', () => {
      const smallContext = 'a'.repeat(SINGLE_PASS_CHAR_THRESHOLD - 1)
      const result = recon(smallContext, {}, {entries: [], totalProcessed: 0})

      expect(result.suggestedMode).to.equal('single-pass')
    })

    it('should recommend chunked for large contexts', () => {
      const largeContext = 'a'.repeat(SINGLE_PASS_CHAR_THRESHOLD + 1)
      const result = recon(largeContext, {}, {entries: [], totalProcessed: 0})

      expect(result.suggestedMode).to.equal('chunked')
    })

    it('should calculate correct suggested chunk count', () => {
      const context = 'a'.repeat(24_000)
      const result = recon(context, {}, {entries: [], totalProcessed: 0})

      expect(result.suggestedChunkCount).to.equal(Math.ceil(24_000 / 8000))
    })

    it('should extract head and tail preview', () => {
      const context = 'HEAD_START' + 'x'.repeat(5000) + 'TAIL_END'
      const result = recon(context, {}, {entries: [], totalProcessed: 0})

      expect(result.headPreview).to.have.length.at.most(3000)
      expect(result.headPreview).to.include('HEAD_START')
      expect(result.tailPreview).to.have.length.at.most(1000)
      expect(result.tailPreview).to.include('TAIL_END')
    })

    it('should summarize history domains', () => {
      const history = {
        entries: [
          {domain: 'architecture', keyFacts: ['fact1'], title: 'System Design'},
          {domain: 'architecture', keyFacts: ['fact2'], title: 'API Layer'},
          {domain: 'testing', keyFacts: ['fact3'], title: 'Unit Tests'},
        ],
        totalProcessed: 3,
      }

      const result = recon('some context', {}, history)

      expect(result.history.totalProcessed).to.equal(3)
      expect(result.history.domains).to.have.property('architecture')
      expect(result.history.domains.architecture).to.deep.equal(['System Design', 'API Layer'])
      expect(result.history.domains.testing).to.deep.equal(['Unit Tests'])
    })

    it('should handle empty history', () => {
      const result = recon('context', {}, {})

      expect(result.history.totalProcessed).to.equal(0)
      expect(result.history.domains).to.deep.equal({})
    })

    it('should handle entries with missing domain', () => {
      const history = {
        entries: [{keyFacts: ['fact1'], title: 'No Domain'}],
        totalProcessed: 1,
      }

      const result = recon('context', {}, history)

      expect(result.history.domains).to.have.property('unknown')
      expect(result.history.domains.unknown).to.deep.equal(['No Domain'])
    })
  })

  // -----------------------------------------------------------------------
  // chunk
  // -----------------------------------------------------------------------
  describe('chunk()', () => {
    it('should return empty result for empty string', () => {
      const result = chunk('')

      expect(result.chunks).to.have.length(0)
      expect(result.totalChunks).to.equal(0)
      expect(result.boundaries).to.have.length(0)
    })

    it('should return single chunk for content smaller than chunk size', () => {
      const content = 'Small content'
      const result = chunk(content, {size: 1000})

      expect(result.chunks).to.have.length(1)
      expect(result.chunks[0]).to.equal(content)
      expect(result.totalChunks).to.equal(1)
    })

    it('should return single chunk when content equals chunk size', () => {
      const content = 'a'.repeat(8000)
      const result = chunk(content, {size: 8000})

      expect(result.chunks).to.have.length(1)
      expect(result.chunks[0]).to.equal(content)
    })

    it('should split on paragraph boundaries', () => {
      const para1 = 'First paragraph. ' + 'a'.repeat(300)
      const para2 = 'Second paragraph. ' + 'b'.repeat(300)
      const content = para1 + '\n\n' + para2
      const result = chunk(content, {overlap: 0, size: para1.length + 10})

      expect(result.totalChunks).to.be.greaterThanOrEqual(2)
      // First chunk should end at a paragraph boundary
      expect(result.chunks[0]).to.include('First paragraph')
    })

    it('should handle content with message markers', () => {
      const content = 'Intro\n\n[USER]: Hello there\n\n[ASSISTANT]: I can help'
      const result = chunk(content, {overlap: 0, size: 25})

      expect(result.totalChunks).to.be.greaterThanOrEqual(2)
    })

    it('should not split inside code fences when possible', () => {
      const codeFence = '```\nconst x = 1;\nconst y = 2;\n```'
      // Padding before/after must be large enough so the chunk boundary falls
      // near the fence block, and the fence block fits within the 1.2x extension limit.
      const padding = 'Line of text here.\n'.repeat(5)
      const content = padding + codeFence + '\n\n' + padding
      const result = chunk(content, {overlap: 0, size: 120})

      // Verify no chunk starts in the middle of a code fence
      for (const c of result.chunks) {
        const fenceCount = (c.match(/^```/gm) || []).length
        // Each chunk should have either 0 or an even number of fences
        expect(fenceCount % 2).to.equal(
          0,
          `Chunk has unbalanced fences (${fenceCount}): ${JSON.stringify(c)}`,
        )
      }
    })

    it('should support overlap between chunks', () => {
      const content = 'a'.repeat(500)
      const result = chunk(content, {overlap: 50, size: 200})

      // With overlap, adjacent chunks should share some content
      if (result.totalChunks >= 2) {
        const end1 = result.boundaries[0].end
        const start2 = result.boundaries[1].start
        expect(start2).to.be.lessThan(end1)
      }
    })

    it('should guarantee forward progress on long unbroken content', () => {
      // 100K string with no \n\n or \n — forces hard cut
      const content = 'x'.repeat(100_000)
      const result = chunk(content, {overlap: 0, size: 8000})

      expect(result.totalChunks).to.be.greaterThan(1)
      // Verify all content is covered
      const totalLength = result.boundaries.reduce(
        (sum, b) => sum + (b.end - b.start), 0,
      )
      expect(totalLength).to.be.greaterThanOrEqual(content.length)

      // Verify no empty chunks
      for (const c of result.chunks) {
        expect(c.length).to.be.greaterThan(0)
      }
    })

    it('should never produce an infinite loop', () => {
      // Pathological input: single very long line
      const content = 'word '.repeat(20_000)
      const result = chunk(content, {overlap: 100, size: 500})

      // Should terminate and produce reasonable chunks
      expect(result.totalChunks).to.be.greaterThan(1)
      expect(result.totalChunks).to.be.lessThan(1000) // sanity cap
    })

    it('should have boundaries that cover the entire content', () => {
      const content = 'Line 1\n\nLine 2\n\nLine 3\n\nLine 4\n\nLine 5'
      const result = chunk(content, {overlap: 0, size: 15})

      // First boundary starts at 0
      expect(result.boundaries[0].start).to.equal(0)
      // Last boundary ends at content length
      expect(result.boundaries.at(-1)!.end).to.equal(content.length)
    })
  })

  // -----------------------------------------------------------------------
  // detectMessageBoundaries
  // -----------------------------------------------------------------------
  describe('detectMessageBoundaries()', () => {
    it('should find USER and ASSISTANT markers', () => {
      const context = 'start\n\n[USER]: Hello\n\n[ASSISTANT]: Hi there'
      const result = detectMessageBoundaries(context)

      expect(result).to.have.length(2)
      expect(result[0].role).to.equal('user')
      expect(result[1].role).to.equal('assistant')
    })

    it('should return correct offsets (skipping leading newline)', () => {
      const context = 'some text\n[USER]: message'
      const result = detectMessageBoundaries(context)

      expect(result).to.have.length(1)
      // Offset should point to '[USER]:', not the \n before it
      expect(context[result[0].offset]).to.equal('[')
    })

    it('should return sequential indices', () => {
      const context = '\n[USER]: msg1\n[ASSISTANT]: msg2\n[USER]: msg3'
      const result = detectMessageBoundaries(context)

      expect(result).to.have.length(3)
      expect(result[0].index).to.equal(0)
      expect(result[1].index).to.equal(1)
      expect(result[2].index).to.equal(2)
    })

    it('should return empty array for content without markers', () => {
      const result = detectMessageBoundaries('no markers here')

      expect(result).to.have.length(0)
    })

    it('should not match markers without preceding newline', () => {
      // [USER]: at the very start (no preceding \n) should not match
      const result = detectMessageBoundaries('[USER]: first message')

      expect(result).to.have.length(0)
    })
  })

  // -----------------------------------------------------------------------
  // groupBySubject
  // -----------------------------------------------------------------------
  describe('groupBySubject()', () => {
    it('should group facts by subject', () => {
      const facts: CurationFact[] = [
        {statement: 'fact1', subject: 'auth'},
        {statement: 'fact2', subject: 'auth'},
        {statement: 'fact3', subject: 'database'},
      ]

      const result = groupBySubject(facts)

      expect(Object.keys(result)).to.have.length(2)
      expect(result.auth).to.have.length(2)
      expect(result.database).to.have.length(1)
    })

    it('should fall back to category when subject is missing', () => {
      const facts: CurationFact[] = [
        {category: 'project', statement: 'project fact'},
        {category: 'convention', statement: 'convention fact'},
      ]

      const result = groupBySubject(facts)

      expect(result.project).to.have.length(1)
      expect(result.convention).to.have.length(1)
    })

    it('should use "uncategorized" when both subject and category are missing', () => {
      const facts: CurationFact[] = [
        {statement: 'orphan fact 1'},
        {statement: 'orphan fact 2'},
      ]

      const result = groupBySubject(facts)

      expect(result.uncategorized).to.have.length(2)
    })

    it('should prefer subject over category', () => {
      const facts: CurationFact[] = [
        {category: 'project', statement: 'fact with both', subject: 'auth'},
      ]

      const result = groupBySubject(facts)

      expect(result).to.have.property('auth')
      expect(result).to.not.have.property('project')
    })

    it('should handle empty input', () => {
      const result = groupBySubject([])

      expect(result).to.deep.equal({})
    })
  })

  // -----------------------------------------------------------------------
  // dedup
  // -----------------------------------------------------------------------
  describe('dedup()', () => {
    it('should remove near-duplicate facts', () => {
      const facts: CurationFact[] = [
        {statement: 'The system uses TypeScript for backend development'},
        {statement: 'The system uses TypeScript for backend development work'},
        {statement: 'The project uses Python for data analysis'},
      ]

      const result = dedup(facts)

      expect(result).to.have.length(2)
      expect(result[0].statement).to.include('TypeScript')
      expect(result[1].statement).to.include('Python')
    })

    it('should preserve distinct statements', () => {
      const facts: CurationFact[] = [
        {statement: 'Uses React for frontend'},
        {statement: 'Uses PostgreSQL for database'},
        {statement: 'Deployed on AWS infrastructure'},
      ]

      const result = dedup(facts)

      expect(result).to.have.length(3)
    })

    it('should handle empty input', () => {
      const result = dedup([])

      expect(result).to.have.length(0)
    })

    it('should handle single item input', () => {
      const facts: CurationFact[] = [{statement: 'only one'}]
      const result = dedup(facts)

      expect(result).to.have.length(1)
    })

    it('should respect custom threshold', () => {
      const facts: CurationFact[] = [
        {statement: 'The application uses a microservices architecture'},
        {statement: 'The application uses a monolithic architecture'},
      ]

      // With a very high threshold (0.99), they should both survive
      const resultHigh = dedup(facts, 0.99)
      expect(resultHigh).to.have.length(2)

      // With a very low threshold (0.3), they may be deduped
      const resultLow = dedup(facts, 0.3)
      expect(resultLow.length).to.be.lessThanOrEqual(2)
    })

    it('should keep the first occurrence when removing duplicates', () => {
      const facts: CurationFact[] = [
        {statement: 'first version of the statement about testing', subject: 'keep-me'},
        {statement: 'first version of the statement about testing too', subject: 'drop-me'},
      ]

      const result = dedup(facts)

      if (result.length === 1) {
        expect(result[0].subject).to.equal('keep-me')
      }
    })

    it('should handle identical statements', () => {
      const facts: CurationFact[] = [
        {statement: 'exactly the same'},
        {statement: 'exactly the same'},
        {statement: 'exactly the same'},
      ]

      const result = dedup(facts)

      expect(result).to.have.length(1)
    })
  })

  // -----------------------------------------------------------------------
  // recordProgress
  // -----------------------------------------------------------------------
  describe('recordProgress()', () => {
    it('should push entry into history', () => {
      const history: Record<string, unknown> = {entries: [], totalProcessed: 0}
      const entry = {domain: 'architecture', keyFacts: ['fact1', 'fact2'], title: 'System Design'}

      recordProgress(history, entry)

      expect((history as {entries: unknown[]}).entries).to.have.length(1)
      expect((history as {entries: unknown[]}).entries[0]).to.deep.equal(entry)
    })

    it('should increment totalProcessed', () => {
      const history: Record<string, unknown> = {entries: [], totalProcessed: 0}

      recordProgress(history, {domain: 'd1', keyFacts: ['f1'], title: 't1'})
      recordProgress(history, {domain: 'd2', keyFacts: ['f2'], title: 't2'})

      expect(history.totalProcessed).to.equal(2)
    })

    it('should initialize entries array if missing', () => {
      const history: Record<string, unknown> = {totalProcessed: 5}

      recordProgress(history, {domain: 'test', keyFacts: ['f1'], title: 'Test'})

      expect((history as {entries: unknown[]}).entries).to.have.length(1)
      expect(history.totalProcessed).to.equal(6)
    })

    it('should initialize totalProcessed if missing', () => {
      const history: Record<string, unknown> = {}

      recordProgress(history, {domain: 'test', keyFacts: ['f1'], title: 'Test'})

      expect(history.totalProcessed).to.equal(1)
    })

    it('should mutate the original history object', () => {
      const history: Record<string, unknown> = {entries: [], totalProcessed: 0}
      const originalRef = history

      recordProgress(history, {domain: 'test', keyFacts: [], title: 'Test'})

      expect(history).to.equal(originalRef) // same reference
      expect(history.totalProcessed).to.equal(1)
    })
  })

  // -----------------------------------------------------------------------
  // SINGLE_PASS_CHAR_THRESHOLD
  // -----------------------------------------------------------------------
  describe('SINGLE_PASS_CHAR_THRESHOLD', () => {
    it('should equal the shared CURATION_CHAR_THRESHOLD (20,000)', () => {
      expect(SINGLE_PASS_CHAR_THRESHOLD).to.equal(20_000)
    })
  })
})
