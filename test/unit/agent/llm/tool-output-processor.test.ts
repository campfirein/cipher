import {expect} from 'chai'

import {ToolOutputProcessor} from '../../../../src/agent/infra/llm/tool-output-processor.js'

describe('ToolOutputProcessor', () => {
  describe('constructor — threshold scaling', () => {
    it('should use hardcoded defaults when no maxInputTokens provided', async () => {
      const processor = new ToolOutputProcessor()
      const shortContent = 'x'.repeat(5000) // well below 10K curate threshold
      const result = await processor.processOutput('tool', shortContent, 'curate')
      expect(result.metadata?.truncated).to.be.undefined // not truncated
    })

    it('should derive default threshold from 200K context (≈50K chars)', async () => {
      const processor = new ToolOutputProcessor(200_000)
      // 200K × 6.25% × 4 = 50,000 chars
      const justUnder = 'x'.repeat(49_999)
      const result = await processor.processOutput('tool', justUnder)
      expect(result.metadata?.truncated).to.be.undefined

      const justOver = 'x'.repeat(50_001)
      const resultOver = await processor.processOutput('tool', justOver)
      expect(resultOver.metadata?.truncated).to.be.true
    })

    it('should derive curate threshold as 10K chars for 200K model', async () => {
      const processor = new ToolOutputProcessor(200_000)
      // 200K × 1.25% × 4 = 10,000 chars
      const justUnder = 'x'.repeat(9999)
      const r1 = await processor.processOutput('tool', justUnder, 'curate')
      expect(r1.metadata?.truncated).to.be.undefined

      const justOver = 'x'.repeat(10_001)
      const r2 = await processor.processOutput('tool', justOver, 'curate')
      expect(r2.metadata?.truncated).to.be.true
    })

    it('should derive curate threshold as ~1,600 chars for 32K model', async () => {
      const processor = new ToolOutputProcessor(32_000)
      // 32K × 1.25% × 4 = 1,600 chars
      const justUnder = 'x'.repeat(1599)
      const r1 = await processor.processOutput('tool', justUnder, 'curate')
      expect(r1.metadata?.truncated).to.be.undefined

      const justOver = 'x'.repeat(1601)
      const r2 = await processor.processOutput('tool', justOver, 'curate')
      expect(r2.metadata?.truncated).to.be.true
    })

    it('should derive query threshold as 20K chars for 200K model', async () => {
      const processor = new ToolOutputProcessor(200_000)
      // 200K × 2.5% × 4 = 20,000 chars
      const justOver = 'x'.repeat(20_001)
      const result = await processor.processOutput('tool', justOver, 'query')
      expect(result.metadata?.truncated).to.be.true
    })

    it('should scale up thresholds for 1M Gemini model', async () => {
      const processor = new ToolOutputProcessor(1_000_000)
      // 1M × 1.25% × 4 = 50,000 chars for curate threshold
      const content = 'x'.repeat(49_999) // just under 50K
      const result = await processor.processOutput('tool', content, 'curate')
      expect(result.metadata?.truncated).to.be.undefined
    })

    it('should allow explicit config to override computed threshold', async () => {
      const processor = new ToolOutputProcessor(200_000, {threshold: 5000})
      const content = 'x'.repeat(5001)
      const result = await processor.processOutput('tool', content)
      expect(result.metadata?.truncated).to.be.true
    })
  })

  describe('fallback when no maxInputTokens', () => {
    it('should use 10K hardcoded curate threshold', async () => {
      const processor = new ToolOutputProcessor()
      const justOver = 'x'.repeat(10_001)
      const result = await processor.processOutput('tool', justOver, 'curate')
      expect(result.metadata?.truncated).to.be.true
    })

    it('should use 20K hardcoded query threshold', async () => {
      const processor = new ToolOutputProcessor()
      const justOver = 'x'.repeat(20_001)
      const result = await processor.processOutput('tool', justOver, 'query')
      expect(result.metadata?.truncated).to.be.true
    })
  })
})
