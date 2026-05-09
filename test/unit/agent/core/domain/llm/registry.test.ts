import {expect} from 'chai'

import {
  DEFAULT_MAX_INPUT_TOKENS,
  getEffectiveMaxInputTokens,
  getMaxInputTokensForModel,
  getModelInfo,
  modelAcceptsSamplingParameters,
} from '../../../../../../src/agent/core/domain/llm/registry.js'

describe('LLM Registry', () => {
  describe('getModelInfo', () => {
    it('should find Claude 3 Haiku by exact model ID', () => {
      const info = getModelInfo('claude', 'claude-3-haiku-20240307')
      expect(info).to.not.be.undefined
      expect(info!.maxInputTokens).to.equal(200_000)
      expect(info!.charsPerToken).to.equal(3.5)
    })

    it('should find Claude 3.5 Sonnet', () => {
      const info = getModelInfo('claude', 'claude-3-5-sonnet-20241022')
      expect(info).to.not.be.undefined
      expect(info!.maxInputTokens).to.equal(200_000)
    })

    it('should find Claude 4.6 Sonnet', () => {
      const info = getModelInfo('claude', 'claude-sonnet-4-6')
      expect(info).to.not.be.undefined
      expect(info!.maxInputTokens).to.equal(200_000)
    })

    it('should find GPT-4o with correct context', () => {
      const info = getModelInfo('openai', 'gpt-4o')
      expect(info).to.not.be.undefined
      expect(info!.maxInputTokens).to.equal(128_000)
    })

    it('should find o1 with 200K context', () => {
      const info = getModelInfo('openai', 'o1')
      expect(info).to.not.be.undefined
      expect(info!.maxInputTokens).to.equal(200_000)
    })

    it('should return undefined for unknown model', () => {
      const info = getModelInfo('claude', 'claude-99-unknown')
      expect(info).to.be.undefined
    })
  })

  describe('getMaxInputTokensForModel', () => {
    it('should return 200K for Claude 3 Haiku (was 128K before fix)', () => {
      const tokens = getMaxInputTokensForModel('claude', 'claude-3-haiku-20240307')
      expect(tokens).to.equal(200_000)
    })

    it('should return 128K fallback for unknown model', () => {
      const tokens = getMaxInputTokensForModel('claude', 'claude-unknown-future-model')
      expect(tokens).to.equal(DEFAULT_MAX_INPUT_TOKENS)
    })
  })

  describe('getEffectiveMaxInputTokens', () => {
    describe('known model in registry', () => {
      it('should return registry value when no configuredMax', () => {
        const tokens = getEffectiveMaxInputTokens('claude', 'claude-3-haiku-20240307')
        expect(tokens).to.equal(200_000)
      })

      it('should cap at configuredMax when it is lower than registry value', () => {
        const tokens = getEffectiveMaxInputTokens('claude', 'claude-3-haiku-20240307', 100_000)
        expect(tokens).to.equal(100_000)
      })

      it('should use registry value when configuredMax exceeds it', () => {
        // configuredMax of 999K should not inflate beyond registry 200K
        const tokens = getEffectiveMaxInputTokens('claude', 'claude-3-haiku-20240307', 999_000)
        expect(tokens).to.equal(200_000)
      })
    })

    describe('unknown model (e.g. new OpenRouter model)', () => {
      it('should use configuredMax when model is not in registry (the key bug fix)', () => {
        // Before fix: Math.min(128K, 200K) = 128K — WRONG
        // After fix: unknown model → use configuredMax directly = 200K — CORRECT
        const tokens = getEffectiveMaxInputTokens('openai', 'some-new-openrouter-model', 200_000)
        expect(tokens).to.equal(200_000)
      })

      it('should fall back to DEFAULT_MAX_INPUT_TOKENS when no configuredMax and model unknown', () => {
        const tokens = getEffectiveMaxInputTokens('openai', 'totally-unknown-model')
        expect(tokens).to.equal(DEFAULT_MAX_INPUT_TOKENS)
      })

      it('should use configuredMax for 32K model via OpenRouter', () => {
        const tokens = getEffectiveMaxInputTokens('openai', 'some-small-model', 32_000)
        expect(tokens).to.equal(32_000)
      })
    })
  })

  describe('modelAcceptsSamplingParameters', () => {
    it('returns false for claude-opus-4-7 (registry-marked)', () => {
      expect(modelAcceptsSamplingParameters('claude-opus-4-7')).to.equal(false)
    })

    it('returns false for OpenRouter-prefixed claude-opus-4-7', () => {
      expect(modelAcceptsSamplingParameters('anthropic/claude-opus-4-7')).to.equal(false)
    })

    it('returns false for date-suffixed claude-opus-4-7 snapshots (family fallback)', () => {
      expect(modelAcceptsSamplingParameters('claude-opus-4-7-20260101')).to.equal(false)
    })

    it('returns true for claude-opus-4-6', () => {
      expect(modelAcceptsSamplingParameters('claude-opus-4-6')).to.equal(true)
    })

    it('returns true for claude-sonnet-4-6', () => {
      expect(modelAcceptsSamplingParameters('claude-sonnet-4-6')).to.equal(true)
    })

    it('returns true for OpenRouter-prefixed claude-sonnet-4-6', () => {
      expect(modelAcceptsSamplingParameters('anthropic/claude-sonnet-4-6')).to.equal(true)
    })

    it('returns true for unknown models (back-compat)', () => {
      expect(modelAcceptsSamplingParameters('some-future-model')).to.equal(true)
    })

    it('returns true for older Claude 3 models', () => {
      expect(modelAcceptsSamplingParameters('claude-3-opus-20240229')).to.equal(true)
    })
  })
})
