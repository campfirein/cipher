import {expect} from 'chai'

import {MultiStrategyParser} from '../../../../../src/agent/infra/llm/parsing/multi-strategy-parser.js'

describe('MultiStrategyParser', () => {
  describe('Tier 1: marker-based', () => {
    it('should parse JSON between RESULT markers', () => {
      const parser = new MultiStrategyParser()
      const text = 'Some preamble <!-- RESULT_START -->{"key":"value"}<!-- RESULT_END --> epilogue'
      const result = parser.parse(text)

      expect(result).to.not.be.null
      expect(result!.strategy).to.equal('marker-based')
      expect(result!.confidence).to.equal(0.95)
      expect(result!.parsed).to.deep.equal({key: 'value'})
    })

    it('should return null when no markers present', () => {
      const parser = new MultiStrategyParser({enabledTiers: ['marker-based']})
      const result = parser.parse('just plain text')

      expect(result).to.be.null
    })
  })

  describe('Tier 2: json-block', () => {
    it('should parse ```json code blocks', () => {
      const parser = new MultiStrategyParser({enabledTiers: ['json-block']})
      const text = 'Here is the result:\n```json\n{"items": [1, 2, 3]}\n```\nDone.'
      const result = parser.parse(text)

      expect(result).to.not.be.null
      expect(result!.strategy).to.equal('json-block')
      expect(result!.confidence).to.equal(0.85)
      expect(result!.parsed).to.deep.equal({items: [1, 2, 3]})
    })

    it('should parse plain ``` blocks that look like JSON', () => {
      const parser = new MultiStrategyParser({enabledTiers: ['json-block']})
      const text = 'Result:\n```\n[1, 2, 3]\n```'
      const result = parser.parse(text)

      expect(result).to.not.be.null
      expect(result!.parsed).to.deep.equal([1, 2, 3])
    })
  })

  describe('Tier 3: raw-json', () => {
    it('should extract outermost JSON array from text', () => {
      const parser = new MultiStrategyParser({enabledTiers: ['raw-json']})
      const text = 'The result is ["a", "b", "c"] as expected.'
      const result = parser.parse(text)

      expect(result).to.not.be.null
      expect(result!.strategy).to.equal('raw-json')
      expect(result!.confidence).to.equal(0.6)
      expect(result!.parsed).to.deep.equal(['a', 'b', 'c'])
    })

    it('should extract outermost JSON object from text', () => {
      const parser = new MultiStrategyParser({enabledTiers: ['raw-json']})
      const text = 'Here: {"name": "test"} done'
      const result = parser.parse(text)

      expect(result).to.not.be.null
      expect(result!.parsed).to.deep.equal({name: 'test'})
    })

    it('should handle trailing commas via JSON repair', () => {
      const parser = new MultiStrategyParser({enabledTiers: ['raw-json']})
      const text = '["item1", "item2",]'
      const result = parser.parse(text)

      expect(result).to.not.be.null
      expect(result!.parsed).to.deep.equal(['item1', 'item2'])
    })

    it('should handle trailing comma in objects', () => {
      const parser = new MultiStrategyParser({enabledTiers: ['raw-json']})
      const text = '{"a": 1, "b": 2,}'
      const result = parser.parse(text)

      expect(result).to.not.be.null
      expect(result!.parsed).to.deep.equal({a: 1, b: 2})
    })
  })

  describe('Tier 4: key-value', () => {
    it('should extract key-value pairs', () => {
      const parser = new MultiStrategyParser({enabledTiers: ['key-value']})
      const text = 'Score: 0.85\nReason: Good quality\nStatus: pass'
      const result = parser.parse(text)

      expect(result).to.not.be.null
      expect(result!.strategy).to.equal('key-value')
      expect(result!.confidence).to.equal(0.3)
      expect(result!.parsed).to.deep.equal({Reason: 'Good quality', Score: '0.85', Status: 'pass'})
    })

    it('should return null when no key-value patterns found', () => {
      const parser = new MultiStrategyParser({enabledTiers: ['key-value']})
      const result = parser.parse('just some text without colons')

      expect(result).to.be.null
    })
  })

  describe('Fallback chain', () => {
    it('should try tiers in order and return first success', () => {
      const parser = new MultiStrategyParser()
      // This has both markers and raw JSON; markers should win
      const text = '<!-- RESULT_START -->{"from":"markers"}<!-- RESULT_END --> also {"from":"raw"}'
      const result = parser.parse(text)

      expect(result!.strategy).to.equal('marker-based')
      expect(result!.parsed).to.deep.equal({from: 'markers'})
    })

    it('should fall through to next tier when first fails', () => {
      const parser = new MultiStrategyParser()
      // No markers, no code blocks, but has raw JSON
      const text = 'The answer is {"value": 42}'
      const result = parser.parse(text)

      expect(result!.strategy).to.equal('raw-json')
    })

    it('should return null when all tiers fail', () => {
      const parser = new MultiStrategyParser()
      const result = parser.parse('just plain text with no structure')

      expect(result).to.be.null
    })
  })

  describe('Validator', () => {
    it('should reject parsed result that fails validation', () => {
      const parser = new MultiStrategyParser<string[]>({
        enabledTiers: ['raw-json'],
        validator: (v): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string'),
      })
      // This is a valid JSON object, but not a string array
      const result = parser.parse('{"key": "value"}')

      expect(result).to.be.null
    })

    it('should accept parsed result that passes validation', () => {
      const parser = new MultiStrategyParser<string[]>({
        enabledTiers: ['raw-json'],
        validator: (v): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string'),
      })
      const result = parser.parse('["hello", "world"]')

      expect(result).to.not.be.null
      expect(result!.parsed).to.deep.equal(['hello', 'world'])
    })

    it('should fall through to next tier when validator rejects', () => {
      const parser = new MultiStrategyParser<string[]>({
        enabledTiers: ['json-block', 'raw-json'],
        validator: (v): v is string[] => Array.isArray(v),
      })
      // json-block has an object (fails validator), raw-json finds the array
      const text = '```json\n{"not": "array"}\n```\nAlso ["actual", "array"]'
      const result = parser.parse(text)

      expect(result!.strategy).to.equal('raw-json')
      expect(result!.parsed).to.deep.equal(['actual', 'array'])
    })
  })

  describe('enabledTiers option', () => {
    it('should only try specified tiers', () => {
      const parser = new MultiStrategyParser({enabledTiers: ['key-value']})
      // This has valid JSON but key-value tier can't parse it
      const result = parser.parse('["a", "b"]')

      expect(result).to.be.null
    })
  })
})
