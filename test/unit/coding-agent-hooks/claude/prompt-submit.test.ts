/* eslint-disable camelcase */
import {expect} from 'chai'

import {parseHookInput} from '../../../../src/coding-agent-hooks/claude/prompt-submit.js'

describe('coding-agent-hooks/claude/prompt-submit', () => {
  describe('parseHookInput()', () => {
    describe('valid JSON input', () => {
      it('should return cleaned prompt and data when prompt is provided', () => {
        const input = JSON.stringify({prompt: 'Hello world', session_id: 'abc123'})

        const result = parseHookInput(input)

        expect(result).to.deep.equal({
          cleanedPrompt: 'Hello world',
          data: {prompt: 'Hello world', session_id: 'abc123'},
        })
      })

      it('should return undefined for empty prompt string', () => {
        const input = JSON.stringify({prompt: '', session_id: 'test'})

        const result = parseHookInput(input)

        expect(result).to.be.undefined
      })

      it('should return undefined when prompt field is missing', () => {
        const input = JSON.stringify({session_id: 'test'})

        const result = parseHookInput(input)

        expect(result).to.be.undefined
      })

      it('should return cleaned prompt with all hook input fields', () => {
        const input = JSON.stringify({
          cwd: '/test/path',
          hook_event_name: 'UserPromptSubmit',
          permission_mode: 'default',
          prompt: 'test prompt',
          session_id: 'session-123',
          transcript_path: '/path/to/transcript',
        })

        const result = parseHookInput(input)

        expect(result?.cleanedPrompt).to.equal('test prompt')
        expect(result?.data.prompt).to.equal('test prompt')
        expect(result?.data.session_id).to.equal('session-123')
      })

      it('should handle prompts with special characters', () => {
        const input = JSON.stringify({prompt: 'Test with "quotes" and backslash \\'})

        const result = parseHookInput(input)

        expect(result?.cleanedPrompt).to.include('Test with')
        expect(result?.cleanedPrompt).to.include('quotes')
      })

      it('should handle prompts with unicode characters', () => {
        const input = JSON.stringify({prompt: 'Hello 世界 🚀'})

        const result = parseHookInput(input)

        expect(result?.cleanedPrompt).to.equal('Hello 世界 🚀')
      })

      it('should preserve newlines in prompt', () => {
        const input = JSON.stringify({prompt: 'Line 1\nLine 2'})

        const result = parseHookInput(input)

        expect(result?.cleanedPrompt).to.equal('Line 1\nLine 2')
      })
    })

    describe('invalid JSON input', () => {
      it('should return undefined for invalid JSON', () => {
        const result = parseHookInput('not valid json')

        expect(result).to.be.undefined
      })

      it('should return undefined for empty string', () => {
        const result = parseHookInput('')

        expect(result).to.be.undefined
      })

      it('should return undefined for malformed JSON', () => {
        const result = parseHookInput('{"prompt": "missing closing brace"')

        expect(result).to.be.undefined
      })

      it('should return undefined for non-object JSON (string)', () => {
        const result = parseHookInput('"just a string"')

        expect(result).to.be.undefined
      })

      it('should return undefined for JSON array', () => {
        const result = parseHookInput('[1, 2, 3]')

        expect(result).to.be.undefined
      })
    })

    describe('edge cases', () => {
      it('should return undefined for null prompt value', () => {
        const input = JSON.stringify({prompt: null})

        const result = parseHookInput(input)

        expect(result).to.be.undefined
      })

      it('should return undefined for undefined prompt value', () => {
        const input = JSON.stringify({prompt: undefined})

        const result = parseHookInput(input)

        expect(result).to.be.undefined
      })

      it('should truncate very long prompts', () => {
        const longPrompt = 'x'.repeat(30_000) // Longer than MAX_PROMPT_LENGTH (25,000)
        const input = JSON.stringify({prompt: longPrompt})

        const result = parseHookInput(input)

        expect(result?.cleanedPrompt.length).to.be.lessThanOrEqual(25_000)
        expect(result?.cleanedPrompt).to.include('...')
      })

      it('should return undefined for empty object', () => {
        const input = JSON.stringify({})

        const result = parseHookInput(input)

        expect(result).to.be.undefined
      })

      it('should return undefined for numeric prompt (not a string)', () => {
        const input = JSON.stringify({prompt: 123})

        const result = parseHookInput(input)

        expect(result).to.be.undefined
      })
    })
  })
})
