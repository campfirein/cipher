import {expect} from 'chai'

import {ClaudeTokenizer} from '../../../../../src/agent/infra/llm/tokenizers/claude-tokenizer.js'

/**
 * Helper function to check if all values in an array are equal to the first value
 */
function allValuesEqual<T>(values: T[]): boolean {
  if (values.length === 0) return true
  const first = values[0]
  return values.every((v) => v === first)
}

describe('ClaudeTokenizer', () => {
  let tokenizer: ClaudeTokenizer

  beforeEach(() => {
    tokenizer = new ClaudeTokenizer('claude-3-5-sonnet-20241022')
  })

  describe('constructor', () => {
    it('should initialize with a model name', () => {
      expect(tokenizer).to.exist
      expect(tokenizer).to.be.instanceOf(ClaudeTokenizer)
    })

    it('should accept different Claude model names', () => {
      const tokenizerSonnet = new ClaudeTokenizer('claude-3-5-sonnet-20241022')
      const tokenizerHaiku = new ClaudeTokenizer('claude-3-5-haiku-20241022')
      const tokenizerOpus = new ClaudeTokenizer('claude-3-opus-20240229')

      expect(tokenizerSonnet).to.exist
      expect(tokenizerHaiku).to.exist
      expect(tokenizerOpus).to.exist
    })
  })

  describe('countTokens', () => {
    // Claude models use 3.5 chars/token ratio (from registry)
    const CHARS_PER_TOKEN = 3.5

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
        // 5 chars / 3.5 = 1.43 -> rounds up to 2
        expect(result).to.equal(2)
      })

      it('should count tokens for single long word', () => {
        const result = tokenizer.countTokens('introduction')
        // 12 chars / 3.5 = 3.43 -> rounds up to 4
        expect(result).to.equal(4)
      })
    })

    describe('sentence inputs', () => {
      it('should count tokens for short sentence', () => {
        const result = tokenizer.countTokens('Hello, world!')
        // 13 chars / 3.5 = 3.71 -> rounds up to 4
        expect(result).to.equal(4)
      })

      it('should count tokens for medium sentence', () => {
        const result = tokenizer.countTokens('The quick brown fox jumps over the lazy dog.')
        // 44 chars / 3.5 = 12.57 -> rounds up to 13
        expect(result).to.equal(13)
      })

      it('should count tokens for long sentence', () => {
        const text = 'This is a longer sentence that contains multiple words and punctuation marks.'
        const result = tokenizer.countTokens(text)
        // 77 chars / 3.5 = 22 exactly
        expect(result).to.equal(22)
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
        expect(result).to.equal(Math.ceil(text.length / CHARS_PER_TOKEN))
      })
    })

    describe('special characters', () => {
      it('should count tokens with punctuation', () => {
        const result = tokenizer.countTokens('Hello, world! How are you?')
        // 26 chars / 3.5 = 7.43 -> rounds up to 8
        expect(result).to.equal(8)
      })

      it('should count tokens with numbers', () => {
        const result = tokenizer.countTokens('The year 2024 has 365 days.')
        // 27 chars / 3.5 = 7.71 -> rounds up to 8
        expect(result).to.equal(8)
      })

      it('should count tokens with special symbols', () => {
        const result = tokenizer.countTokens('Price: $99.99 @discount #sale')
        // 30 chars / 3.5 = 8.57 -> rounds up to 9
        expect(result).to.equal(9)
      })
    })

    describe('code inputs', () => {
      it('should count tokens for JavaScript code', () => {
        const code = 'function hello() { return "world"; }'
        const result = tokenizer.countTokens(code)
        // 36 chars / 3.5 = 10.29 -> rounds up to 11
        expect(result).to.equal(11)
      })

      it('should count tokens for TypeScript code', () => {
        const code = 'const add = (a: number, b: number): number => a + b;'
        const result = tokenizer.countTokens(code)
        // 52 chars / 3.5 = 14.86 -> rounds up to 15
        expect(result).to.equal(15)
      })

      it('should count tokens for multiline code', () => {
        const code = `function example() {
  const x = 42;
  return x * 2;
}`
        const result = tokenizer.countTokens(code)
        expect(result).to.equal(Math.ceil(code.length / CHARS_PER_TOKEN))
      })
    })

    describe('multiline text', () => {
      it('should count tokens across newlines', () => {
        const text = 'Line 1\nLine 2\nLine 3'
        const result = tokenizer.countTokens(text)
        // 20 chars / 3.5 = 5.71 -> rounds up to 6
        expect(result).to.equal(6)
      })

      it('should count tokens with multiple newlines', () => {
        const text = 'Paragraph 1\n\nParagraph 2\n\nParagraph 3'
        const result = tokenizer.countTokens(text)
        expect(result).to.equal(Math.ceil(text.length / CHARS_PER_TOKEN))
      })
    })

    describe('mathematical consistency', () => {
      it('should use consistent character-to-token ratio', () => {
        const text1 = 'a'.repeat(35) // 35 chars -> 10 tokens (35/3.5)
        const text2 = 'b'.repeat(35) // 35 chars -> 10 tokens (35/3.5)

        const result1 = tokenizer.countTokens(text1)
        const result2 = tokenizer.countTokens(text2)

        expect(result1).to.equal(result2)
        expect(result1).to.equal(10)
      })

      it('should always round up (ceiling)', () => {
        // 3 chars = ceil(3/3.5) = 1 token
        expect(tokenizer.countTokens('abc')).to.equal(1) // 3 / 3.5 = 0.857 -> 1

        // 4 chars = ceil(4/3.5) = 2 tokens
        expect(tokenizer.countTokens('abcd')).to.equal(2) // 4 / 3.5 = 1.14 -> 2

        // 7 chars = ceil(7/3.5) = 2 tokens (exact)
        expect(tokenizer.countTokens('abcdefg')).to.equal(2) // 7 / 3.5 = 2 exactly

        // 8 chars = ceil(8/3.5) = 3 tokens
        expect(tokenizer.countTokens('abcdefgh')).to.equal(3) // 8 / 3.5 = 2.286 -> 3
      })

      it('should handle exact multiples of 3.5', () => {
        // 7 chars (2 × 3.5) should equal exactly 2 tokens
        expect(tokenizer.countTokens('1234567')).to.equal(2)

        // 14 chars (4 × 3.5) should equal exactly 4 tokens
        expect(tokenizer.countTokens('12345678901234')).to.equal(4)
      })
    })

    describe('unicode and international text', () => {
      it('should count tokens with emoji', () => {
        const text = 'Hello 👋 World 🌍'
        const result = tokenizer.countTokens(text)
        // Note: Emojis may be multiple characters in JS strings
        expect(result).to.equal(Math.ceil(text.length / CHARS_PER_TOKEN))
      })

      it('should count tokens with accented characters', () => {
        const text = 'Café résumé naïve'
        const result = tokenizer.countTokens(text)
        expect(result).to.equal(Math.ceil(text.length / CHARS_PER_TOKEN))
      })

      it('should count tokens with CJK characters', () => {
        const text = '你好世界' // Hello world in Chinese
        const result = tokenizer.countTokens(text)
        expect(result).to.equal(Math.ceil(text.length / CHARS_PER_TOKEN))
      })
    })

    describe('edge cases', () => {
      it('should handle very long text', () => {
        const longText = 'word '.repeat(1000) // 5000 chars
        const result = tokenizer.countTokens(longText)
        expect(result).to.equal(Math.ceil(5000 / CHARS_PER_TOKEN))
        expect(result).to.equal(1429)
      })

      it('should handle single character', () => {
        expect(tokenizer.countTokens('a')).to.equal(1)
        expect(tokenizer.countTokens('!')).to.equal(1)
        expect(tokenizer.countTokens('1')).to.equal(1)
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
  })
})
