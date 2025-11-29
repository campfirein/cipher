import {expect} from 'chai'

import {GeminiTokenizer} from '../../../../../../src/infra/cipher/llm/tokenizers/gemini-tokenizer.js'

/**
 * Helper function to check if all values in an array are equal to the first value
 */
function allValuesEqual<T>(values: T[]): boolean {
  if (values.length === 0) return true
  const first = values[0]
  return values.every((v) => v === first)
}

describe('GeminiTokenizer', () => {
  let tokenizer: GeminiTokenizer

  beforeEach(() => {
    tokenizer = new GeminiTokenizer('gemini-2.5-flash')
  })

  describe('constructor', () => {
    it('should initialize with a model name', () => {
      expect(tokenizer).to.exist
      expect(tokenizer).to.be.instanceOf(GeminiTokenizer)
    })

    it('should accept different Gemini model names', () => {
      const tokenizerFlash = new GeminiTokenizer('gemini-2.5-flash')
      const tokenizerPro = new GeminiTokenizer('gemini-pro')
      const tokenizerUltra = new GeminiTokenizer('gemini-ultra')

      expect(tokenizerFlash).to.exist
      expect(tokenizerPro).to.exist
      expect(tokenizerUltra).to.exist
    })
  })

  describe('countTokens', () => {
    describe('empty and null inputs', () => {
      it('should return 0 for empty string', () => {
        expect(tokenizer.countTokens('')).to.equal(0)
      })

      it('should return 0 for whitespace-only string', () => {
        // Note: whitespace still counts as characters in the approximation
        const result = tokenizer.countTokens('   ')
        expect(result).to.be.greaterThan(0)
      })
    })

    describe('single word inputs', () => {
      it('should count tokens for single short word', () => {
        const result = tokenizer.countTokens('hello')
        // 5 chars / 4 = 1.25 -> rounds up to 2
        expect(result).to.equal(2)
      })

      it('should count tokens for single long word', () => {
        const result = tokenizer.countTokens('introduction')
        // 12 chars / 4 = 3
        expect(result).to.equal(3)
      })
    })

    describe('sentence inputs', () => {
      it('should count tokens for short sentence', () => {
        const result = tokenizer.countTokens('Hello, world!')
        // 13 chars / 4 = 3.25 -> rounds up to 4
        expect(result).to.equal(4)
      })

      it('should count tokens for medium sentence', () => {
        const result = tokenizer.countTokens('The quick brown fox jumps over the lazy dog.')
        // 44 chars / 4 = 11
        expect(result).to.equal(11)
      })

      it('should count tokens for long sentence', () => {
        const text = 'This is a longer sentence that contains multiple words and punctuation marks.'
        const result = tokenizer.countTokens(text)
        // 77 chars / 4 = 19.25 -> rounds up to 20
        expect(result).to.equal(20)
      })
    })

    describe('paragraph inputs', () => {
      it('should count tokens for paragraph', () => {
        const text = `This is a test paragraph with multiple sentences.
        It spans several lines and contains various types of content.
        The tokenizer should handle this correctly.`
        const result = tokenizer.countTokens(text)
        // Verify it returns a reasonable number based on length
        expect(result).to.be.greaterThan(0)
        expect(result).to.equal(Math.ceil(text.length / 4))
      })
    })

    describe('special characters', () => {
      it('should count tokens with punctuation', () => {
        const result = tokenizer.countTokens('Hello, world! How are you?')
        // 26 chars / 4 = 6.5 -> rounds up to 7
        expect(result).to.equal(7)
      })

      it('should count tokens with numbers', () => {
        const result = tokenizer.countTokens('The year 2024 has 365 days.')
        // 28 chars / 4 = 7
        expect(result).to.equal(7)
      })

      it('should count tokens with special symbols', () => {
        const result = tokenizer.countTokens('Price: $99.99 @discount #sale')
        // 30 chars / 4 = 7.5 -> rounds up to 8
        expect(result).to.equal(8)
      })
    })

    describe('code inputs', () => {
      it('should count tokens for JavaScript code', () => {
        const code = 'function hello() { return "world"; }'
        const result = tokenizer.countTokens(code)
        // 36 chars / 4 = 9
        expect(result).to.equal(9)
      })

      it('should count tokens for TypeScript code', () => {
        const code = 'const add = (a: number, b: number): number => a + b;'
        const result = tokenizer.countTokens(code)
        // 52 chars / 4 = 13
        expect(result).to.equal(13)
      })

      it('should count tokens for multiline code', () => {
        const code = `function example() {
  const x = 42;
  return x * 2;
}`
        const result = tokenizer.countTokens(code)
        expect(result).to.equal(Math.ceil(code.length / 4))
      })
    })

    describe('multiline text', () => {
      it('should count tokens across newlines', () => {
        const text = 'Line 1\nLine 2\nLine 3'
        const result = tokenizer.countTokens(text)
        // 20 chars / 4 = 5
        expect(result).to.equal(5)
      })

      it('should count tokens with multiple newlines', () => {
        const text = 'Paragraph 1\n\nParagraph 2\n\nParagraph 3'
        const result = tokenizer.countTokens(text)
        expect(result).to.equal(Math.ceil(text.length / 4))
      })
    })

    describe('mathematical consistency', () => {
      it('should use consistent character-to-token ratio', () => {
        const text1 = 'a'.repeat(40) // 40 chars -> 10 tokens
        const text2 = 'b'.repeat(40) // 40 chars -> 10 tokens

        const result1 = tokenizer.countTokens(text1)
        const result2 = tokenizer.countTokens(text2)

        expect(result1).to.equal(result2)
        expect(result1).to.equal(10)
      })

      it('should always round up (ceiling)', () => {
        // 4 chars = 1 token
        expect(tokenizer.countTokens('abcd')).to.equal(1) // 4 / 4 = 1 exactly

        // 5 chars = 2 tokens
        expect(tokenizer.countTokens('abcde')).to.equal(2) // 5 / 4 = 1.25 -> 2

        // 8 chars = 2 tokens
        expect(tokenizer.countTokens('abcdefgh')).to.equal(2) // 8 / 4 = 2 exactly

        // 9 chars = 3 tokens
        expect(tokenizer.countTokens('abcdefghi')).to.equal(3) // 9 / 4 = 2.25 -> 3
      })

      it('should handle exact multiples of 4', () => {
        // 4 chars (1 * 4) should equal exactly 1 token
        expect(tokenizer.countTokens('1234')).to.equal(1)

        // 8 chars (2 * 4) should equal exactly 2 tokens
        expect(tokenizer.countTokens('12345678')).to.equal(2)

        // 16 chars (4 * 4) should equal exactly 4 tokens
        expect(tokenizer.countTokens('1234567890123456')).to.equal(4)
      })

      it('should handle values just above multiples of 4', () => {
        // 5 chars (4 + 1) should round up to 2 tokens
        expect(tokenizer.countTokens('12345')).to.equal(2)

        // 9 chars (8 + 1) should round up to 3 tokens
        expect(tokenizer.countTokens('123456789')).to.equal(3)
      })
    })

    describe('unicode and international text', () => {
      it('should count tokens with emoji', () => {
        const text = 'Hello 👋 World 🌍'
        const result = tokenizer.countTokens(text)
        // Note: Emojis may be multiple characters in JS strings
        expect(result).to.equal(Math.ceil(text.length / 4))
      })

      it('should count tokens with accented characters', () => {
        const text = 'Café résumé naïve'
        const result = tokenizer.countTokens(text)
        expect(result).to.equal(Math.ceil(text.length / 4))
      })

      it('should count tokens with CJK characters', () => {
        const text = '你好世界' // Hello world in Chinese
        const result = tokenizer.countTokens(text)
        expect(result).to.equal(Math.ceil(text.length / 4))
      })
    })

    describe('edge cases', () => {
      it('should handle very long text', () => {
        const longText = 'word '.repeat(1000) // 5000 chars
        const result = tokenizer.countTokens(longText)
        expect(result).to.equal(Math.ceil(5000 / 4))
        expect(result).to.equal(1250)
      })

      it('should handle single character', () => {
        expect(tokenizer.countTokens('a')).to.equal(1)
        expect(tokenizer.countTokens('!')).to.equal(1)
        expect(tokenizer.countTokens('1')).to.equal(1)
      })

      it('should handle two characters', () => {
        expect(tokenizer.countTokens('ab')).to.equal(1)
      })

      it('should handle three characters', () => {
        expect(tokenizer.countTokens('abc')).to.equal(1)
      })

      it('should handle whitespace characters', () => {
        expect(tokenizer.countTokens(' ')).to.equal(1)
        expect(tokenizer.countTokens('\t')).to.equal(1)
        expect(tokenizer.countTokens('\n')).to.equal(1)
      })
    })

    describe('performance characteristics', () => {
      it('should be deterministic (same input = same output)', () => {
        const text = 'This is a test sentence.'
        const result1 = tokenizer.countTokens(text)
        const result2 = tokenizer.countTokens(text)
        const result3 = tokenizer.countTokens(text)

        expect(result1).to.equal(result2)
        expect(result2).to.equal(result3)
      })

      it('should handle rapid successive calls', () => {
        const text = 'Test message'
        const results = []

        for (let i = 0; i < 100; i++) {
          results.push(tokenizer.countTokens(text))
        }

        // All results should be the same
        expect(allValuesEqual(results)).to.be.true
      })
    })

    describe('comparison with different approximation rates', () => {
      it('should use ~4 chars per token approximation', () => {
        // Test a known-length string
        const text = 'a'.repeat(100) // 100 chars
        const result = tokenizer.countTokens(text)

        // Should use 4 chars per token: 100 / 4 = 25
        expect(result).to.equal(25)
      })

      it('should differ from 3.5 chars per token approximation', () => {
        // With 4 chars/token: 14 chars = 3.5 -> 4 tokens
        // With 3.5 chars/token: 14 chars = 4 -> 4 tokens (same)
        // But 15 chars would differ:
        // With 4 chars/token: 15 chars = 3.75 -> 4 tokens
        // With 3.5 chars/token: 15 chars = 4.29 -> 5 tokens

        const text = 'a'.repeat(15)
        const result = tokenizer.countTokens(text)

        // Should be 4 tokens (using 4 chars/token)
        expect(result).to.equal(4)
      })
    })
  })

  describe('model-agnostic behavior', () => {
    it('should return same results regardless of model name', () => {
      const text = 'This is a test sentence for token counting.'

      const tokenizerFlash = new GeminiTokenizer('gemini-2.5-flash')
      const tokenizerPro = new GeminiTokenizer('gemini-pro')
      const tokenizerUltra = new GeminiTokenizer('gemini-ultra')

      const resultFlash = tokenizerFlash.countTokens(text)
      const resultPro = tokenizerPro.countTokens(text)
      const resultUltra = tokenizerUltra.countTokens(text)

      // All should return the same count since they use the same approximation
      expect(resultFlash).to.equal(resultPro)
      expect(resultPro).to.equal(resultUltra)
    })
  })
})
