/* eslint-disable camelcase */
import {expect} from 'chai'

import {parseStopHookInput} from '../../../../src/coding-agent-hooks/claude/stop.js'

describe('coding-agent-hooks/claude/stop', () => {
  describe('parseStopHookInput()', () => {
    describe('valid JSON input', () => {
      it('should return parsed data when session_id is provided', () => {
        const input = JSON.stringify({
          hook_event_name: 'Stop',
          session_id: 'abc123',
          stop_hook_active: true,
          transcript_path: '~/.claude/projects/.../00893aaf.jsonl',
        })

        const result = parseStopHookInput(input)

        expect(result).to.deep.equal({
          hook_event_name: 'Stop',
          session_id: 'abc123',
          stop_hook_active: true,
          transcript_path: '~/.claude/projects/.../00893aaf.jsonl',
        })
      })

      it('should return parsed data with undefined session_id', () => {
        const input = JSON.stringify({
          hook_event_name: 'Stop',
          stop_hook_active: true,
        })

        const result = parseStopHookInput(input)

        expect(result).to.deep.equal({
          hook_event_name: 'Stop',
          stop_hook_active: true,
        })
        expect(result?.session_id).to.be.undefined
      })

      it('should return all hook input fields', () => {
        const input = JSON.stringify({
          cwd: '/test/path',
          hook_event_name: 'Stop',
          session_id: 'session-456',
          stop_hook_active: true,
          transcript_path: '/path/to/transcript.jsonl',
        })

        const result = parseStopHookInput(input)

        expect(result?.cwd).to.equal('/test/path')
        expect(result?.session_id).to.equal('session-456')
        expect(result?.transcript_path).to.equal('/path/to/transcript.jsonl')
      })

      it('should handle stop_hook_active being false', () => {
        const input = JSON.stringify({
          session_id: 'test-session',
          stop_hook_active: false,
        })

        const result = parseStopHookInput(input)

        expect(result?.stop_hook_active).to.equal(false)
      })
    })

    describe('invalid JSON input', () => {
      it('should return undefined for invalid JSON', () => {
        const result = parseStopHookInput('not valid json')

        expect(result).to.be.undefined
      })

      it('should return undefined for empty string', () => {
        const result = parseStopHookInput('')

        expect(result).to.be.undefined
      })

      it('should return undefined for malformed JSON', () => {
        const result = parseStopHookInput('{"session_id": "missing closing brace"')

        expect(result).to.be.undefined
      })
    })

    describe('edge cases', () => {
      it('should transform null session_id to undefined', () => {
        const input = JSON.stringify({session_id: null})

        const result = parseStopHookInput(input)

        // null values are now transformed to undefined for consistency
        expect(result).to.deep.equal({session_id: undefined})
      })

      it('should return parsed data for empty object', () => {
        const input = JSON.stringify({})

        const result = parseStopHookInput(input)

        expect(result).to.deep.equal({})
      })

      it('should handle session_id with special characters', () => {
        const input = JSON.stringify({session_id: '00893aaf-19fa-41d2-8238-13269b9b3ca0'})

        const result = parseStopHookInput(input)

        expect(result?.session_id).to.equal('00893aaf-19fa-41d2-8238-13269b9b3ca0')
      })
    })
  })
})
