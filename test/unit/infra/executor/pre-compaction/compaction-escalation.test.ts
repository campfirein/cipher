import {expect} from 'chai'

import {
  buildDeterministicFallbackCompaction,
  estimateTokens,
  isCompactionOutputValid,
  shouldAcceptCompactionOutput,
  withAggressiveCompactionDirective,
} from '../../../../../src/server/infra/executor/pre-compaction/compaction-escalation.js'

describe('compaction-escalation', () => {
  describe('estimateTokens', () => {
    it('should return 0 for empty string', () => {
      expect(estimateTokens('')).to.equal(0)
    })

    it('should return 0 for falsy input', () => {
      expect(estimateTokens(undefined as unknown as string)).to.equal(0)
    })

    it('should estimate tokens as round(length / 4)', () => {
      // 400 chars / 4 = 100 tokens
      const text = 'a'.repeat(400)
      expect(estimateTokens(text)).to.equal(100)
    })

    it('should round correctly for non-divisible lengths', () => {
      // 401 chars / 4 = 100.25 → rounds to 100
      expect(estimateTokens('a'.repeat(401))).to.equal(100)
      // 402 chars / 4 = 100.5 → rounds to 100 (Math.round rounds .5 up in some cases)
      expect(estimateTokens('a'.repeat(402))).to.equal(101)
    })
  })

  describe('shouldAcceptCompactionOutput', () => {
    it('should reject empty output', () => {
      expect(shouldAcceptCompactionOutput('', 100)).to.be.false
    })

    it('should reject whitespace-only output', () => {
      expect(shouldAcceptCompactionOutput('   \n\t  ', 100)).to.be.false
    })

    it('should reject when inputTokens is not finite', () => {
      expect(shouldAcceptCompactionOutput('some text', Infinity)).to.be.false
      expect(shouldAcceptCompactionOutput('some text', Number.NaN)).to.be.false
    })

    it('should reject when inputTokens <= 1', () => {
      expect(shouldAcceptCompactionOutput('some text', 1)).to.be.false
      expect(shouldAcceptCompactionOutput('some text', 0)).to.be.false
      expect(shouldAcceptCompactionOutput('some text', -5)).to.be.false
    })

    it('should accept when output tokens are strictly less than input tokens', () => {
      // 396 chars = 99 tokens, input = 100 → 99 < 100 → accept
      const output = 'a'.repeat(396)
      expect(shouldAcceptCompactionOutput(output, 100)).to.be.true
    })

    it('should reject when output tokens equal input tokens', () => {
      // 400 chars = 100 tokens, input = 100 → 100 < 100 is false → reject
      const output = 'a'.repeat(400)
      expect(shouldAcceptCompactionOutput(output, 100)).to.be.false
    })

    it('should reject when output tokens exceed input tokens', () => {
      // 404 chars = 101 tokens, input = 100 → reject
      const output = 'a'.repeat(404)
      expect(shouldAcceptCompactionOutput(output, 100)).to.be.false
    })
  })

  describe('isCompactionOutputValid', () => {
    it('should reject output shorter than 50 chars', () => {
      expect(isCompactionOutputValid('Short text.')).to.be.false
      expect(isCompactionOutputValid('a'.repeat(49))).to.be.false
    })

    it('should reject common LLM refusal patterns', () => {
      expect(isCompactionOutputValid("I cannot help with that request because it would require access to external resources.")).to.be.false
      expect(isCompactionOutputValid("Sorry, I don't have enough information to compact this text properly for you.")).to.be.false
      expect(isCompactionOutputValid("Not found. The knowledge base does not contain information about this topic at all.")).to.be.false
      expect(isCompactionOutputValid("As an AI language model, I'm not able to process raw text in this particular way here.")).to.be.false
      expect(isCompactionOutputValid("Based on my training data, I cannot determine the appropriate compaction for this text.")).to.be.false
    })

    it('should accept output >= 200 chars unconditionally (valid prose)', () => {
      // Plain prose without any markdown structure — should still pass at >= 200 chars
      const plainProse = 'The system uses a three-phase approach for context management. ' +
        'First, it estimates token counts using character-based heuristics. ' +
        'Then it applies compression when the context exceeds configured thresholds. ' +
        'Finally, it validates the output meets quality gates before accepting.'
      expect(plainProse.length).to.be.greaterThanOrEqual(200)
      expect(isCompactionOutputValid(plainProse)).to.be.true
    })

    it('should require structural signals for 50-199 char output', () => {
      // 80-char plain text without structure → reject
      const plainShort = 'This is a compacted version of the original text that has some useful content here.'
      expect(plainShort.length).to.be.greaterThanOrEqual(50)
      expect(plainShort.length).to.be.lessThan(200)
      expect(isCompactionOutputValid(plainShort)).to.be.false
    })

    it('should accept 50-199 char output with list items', () => {
      const withList = '- Item one: configuration setup\n- Item two: deployment\n- Item three: verification'
      expect(withList.length).to.be.greaterThanOrEqual(50)
      expect(withList.length).to.be.lessThan(200)
      expect(isCompactionOutputValid(withList)).to.be.true
    })

    it('should accept 50-199 char output with code blocks', () => {
      const withCode = 'The function uses:\n```\nestimateTokens(text)\n```\nto count tokens heuristically.'
      expect(withCode.length).to.be.greaterThanOrEqual(50)
      expect(isCompactionOutputValid(withCode)).to.be.true
    })

    it('should accept 50-199 char output with headers', () => {
      const withHeader = '## Overview\nThe compaction service reduces context size before curation begins.'
      expect(withHeader.length).to.be.greaterThanOrEqual(50)
      expect(isCompactionOutputValid(withHeader)).to.be.true
    })

    it('should accept 50-199 char output with 3+ lines', () => {
      const multiLine = 'Line one content here\nLine two content here\nLine three content here'
      expect(multiLine.length).to.be.greaterThanOrEqual(50)
      expect(multiLine.split('\n').length).to.be.greaterThanOrEqual(3)
      expect(isCompactionOutputValid(multiLine)).to.be.true
    })
  })

  describe('withAggressiveCompactionDirective', () => {
    it('should append aggressive header to prompt', () => {
      const prompt = 'Compact the following text.'
      const result = withAggressiveCompactionDirective(prompt)
      expect(result).to.include('## Aggressive Compression Override')
      expect(result).to.include('escalation pass 2')
    })

    it('should be idempotent — does not double-append', () => {
      const prompt = 'Compact the following text.'
      const first = withAggressiveCompactionDirective(prompt)
      const second = withAggressiveCompactionDirective(first)
      expect(second).to.equal(first)
    })

    it('should trim the original prompt', () => {
      const prompt = '  Compact the following text.  \n\n'
      const result = withAggressiveCompactionDirective(prompt)
      expect(result).to.match(/^Compact the following text\./)
    })
  })

  describe('buildDeterministicFallbackCompaction', () => {
    it('should return empty string for empty source', () => {
      const result = buildDeterministicFallbackCompaction({
        inputTokens: 100,
        sourceText: '',
        suffixLabel: 'test',
      })
      expect(result).to.equal('')
    })

    it('should produce output with strictly fewer tokens than input', () => {
      const source = 'a'.repeat(1000)
      const inputTokens = estimateTokens(source)
      const result = buildDeterministicFallbackCompaction({
        inputTokens,
        sourceText: source,
        suffixLabel: 'test',
      })
      expect(estimateTokens(result)).to.be.lessThan(inputTokens)
    })

    it('should include the suffix label when possible', () => {
      const source = 'a'.repeat(1000)
      const inputTokens = estimateTokens(source)
      const result = buildDeterministicFallbackCompaction({
        inputTokens,
        sourceText: source,
        suffixLabel: 'pre-curation compaction',
      })
      expect(result).to.include('pre-curation compaction')
      expect(result).to.include('truncated from')
    })

    it('should return source as-is when inputTokens is not finite', () => {
      const source = 'hello world'
      const result = buildDeterministicFallbackCompaction({
        inputTokens: Infinity,
        sourceText: source,
        suffixLabel: 'test',
      })
      expect(result).to.equal(source)
    })

    it('should handle pathological tiny inputs', () => {
      const result = buildDeterministicFallbackCompaction({
        inputTokens: 2,
        sourceText: 'abcdefgh',
        suffixLabel: 'test',
      })
      // Should produce something non-empty
      expect(result.length).to.be.greaterThan(0)
      expect(estimateTokens(result)).to.be.lessThan(2)
    })
  })
})
