import {expect} from 'chai'

import {parseInput} from '../../../../src/infra/cipher/command-parser.js'

describe('command-parser', () => {
  describe('parseInput()', () => {
    describe('command detection', () => {
      it('should detect slash commands', () => {
        const result = parseInput('/help')

        expect(result.type).to.equal('command')
        if (result.type === 'command') {
          expect(result.command).to.equal('help')
        }
      })

      it('should detect command with arguments', () => {
        const result = parseInput('/delete session-123')

        expect(result.type).to.equal('command')
        if (result.type === 'command') {
          expect(result.command).to.equal('delete')
          expect(result.args).to.deep.equal(['session-123'])
        }
      })

      it('should distinguish commands from regular prompts', () => {
        const result = parseInput('this is a regular prompt')

        expect(result.type).to.equal('prompt')
        expect(result.rawInput).to.equal('this is a regular prompt')
      })

      it('should handle empty input as prompt', () => {
        const result = parseInput('')

        expect(result.type).to.equal('prompt')
        expect(result.rawInput).to.equal('')
      })

      it('should handle whitespace-only input as prompt', () => {
        const result = parseInput('   ')

        expect(result.type).to.equal('prompt')
        expect(result.rawInput).to.equal('   ')
      })

      it('should handle just "/" as command with empty command name', () => {
        const result = parseInput('/')

        expect(result.type).to.equal('command')
        if (result.type === 'command') {
          expect(result.command).to.equal('')
          expect(result.args).to.deep.equal([])
        }
      })

      it('should trim leading/trailing whitespace for commands', () => {
        const result = parseInput('  /help  ')

        expect(result.type).to.equal('command')
        if (result.type === 'command') {
          expect(result.command).to.equal('help')
        }
      })
    })

    describe('command parsing', () => {
      it('should extract command name correctly', () => {
        const result = parseInput('/status')

        expect(result.type).to.equal('command')
        if (result.type === 'command') {
          expect(result.command).to.equal('status')
          expect(result.args).to.deep.equal([])
        }
      })

      it('should parse simple arguments', () => {
        const result = parseInput('/delete session-123')

        expect(result.type).to.equal('command')
        if (result.type === 'command') {
          expect(result.command).to.equal('delete')
          expect(result.args).to.deep.equal(['session-123'])
        }
      })

      it('should parse multiple arguments', () => {
        const result = parseInput('/command arg1 arg2 arg3')

        expect(result.type).to.equal('command')
        if (result.type === 'command') {
          expect(result.command).to.equal('command')
          expect(result.args).to.deep.equal(['arg1', 'arg2', 'arg3'])
        }
      })

      it('should handle command with no arguments', () => {
        const result = parseInput('/help')

        expect(result.type).to.equal('command')
        if (result.type === 'command') {
          expect(result.command).to.equal('help')
          expect(result.args).to.deep.equal([])
        }
      })

      it('should preserve raw input', () => {
        const result = parseInput('/delete session-123')

        expect(result.rawInput).to.equal('/delete session-123')
      })

      it('should preserve trimmed raw input', () => {
        const result = parseInput('  /help  ')

        expect(result.rawInput).to.equal('/help')
      })
    })

    describe('quoted argument parsing', () => {
      it('should parse single-quoted arguments', () => {
        const result = parseInput("/delete 'session with spaces'")

        expect(result.type).to.equal('command')
        if (result.type === 'command') {
          expect(result.command).to.equal('delete')
          expect(result.args).to.deep.equal(['session with spaces'])
        }
      })

      it('should parse double-quoted arguments', () => {
        const result = parseInput('/delete "another session"')

        expect(result.type).to.equal('command')
        if (result.type === 'command') {
          expect(result.command).to.equal('delete')
          expect(result.args).to.deep.equal(['another session'])
        }
      })

      it('should parse mixed quotes', () => {
        const result = parseInput("/cmd arg1 \"arg 2\" 'arg 3'")

        expect(result.type).to.equal('command')
        if (result.type === 'command') {
          expect(result.command).to.equal('cmd')
          expect(result.args).to.deep.equal(['arg1', 'arg 2', 'arg 3'])
        }
      })

      it('should handle escaped quotes with double quotes', () => {
        const result = parseInput(String.raw`/delete "session\"name"`)

        expect(result.type).to.equal('command')
        if (result.type === 'command') {
          expect(result.command).to.equal('delete')
          expect(result.args).to.deep.equal(['session"name'])
        }
      })

      it('should handle escaped quotes with single quotes', () => {
        const result = parseInput(String.raw`/delete 'session\'name'`)

        expect(result.type).to.equal('command')
        if (result.type === 'command') {
          expect(result.command).to.equal('delete')
          expect(result.args).to.deep.equal(["session'name"])
        }
      })

      it('should handle escaped backslashes', () => {
        const result = parseInput(String.raw`/cmd "path\\to\\file"`)

        expect(result.type).to.equal('command')
        if (result.type === 'command') {
          expect(result.command).to.equal('cmd')
          expect(result.args).to.deep.equal([String.raw`path\to\file`])
        }
      })

      it('should handle unterminated quotes', () => {
        const result = parseInput('/delete "unterminated')

        expect(result.type).to.equal('command')
        if (result.type === 'command') {
          expect(result.command).to.equal('delete')
          // Unterminated quote consumes rest of input
          expect(result.args).to.deep.equal(['unterminated'])
        }
      })

      it('should handle empty quoted strings', () => {
        const result = parseInput('/cmd "" arg2')

        expect(result.type).to.equal('command')
        if (result.type === 'command') {
          expect(result.command).to.equal('cmd')
          expect(result.args).to.deep.equal(['arg2'])
        }
      })

      it('should handle quotes in middle of argument', () => {
        const result = parseInput('/cmd arg"with"quotes')

        expect(result.type).to.equal('command')
        if (result.type === 'command') {
          expect(result.command).to.equal('cmd')
          expect(result.args).to.deep.equal(['argwithquotes'])
        }
      })
    })

    describe('whitespace handling', () => {
      it('should handle multiple spaces between arguments', () => {
        const result = parseInput('/cmd   arg1    arg2')

        expect(result.type).to.equal('command')
        if (result.type === 'command') {
          expect(result.command).to.equal('cmd')
          expect(result.args).to.deep.equal(['arg1', 'arg2'])
        }
      })

      it('should handle tab characters', () => {
        const result = parseInput('/cmd\targ1\t\targ2')

        expect(result.type).to.equal('command')
        if (result.type === 'command') {
          expect(result.command).to.equal('cmd')
          expect(result.args).to.deep.equal(['arg1', 'arg2'])
        }
      })

      it('should preserve whitespace in quoted strings', () => {
        const result = parseInput('/cmd "  spaces  "')

        expect(result.type).to.equal('command')
        if (result.type === 'command') {
          expect(result.command).to.equal('cmd')
          expect(result.args).to.deep.equal(['  spaces  '])
        }
      })

      it('should handle trailing whitespace in commands', () => {
        const result = parseInput('/cmd arg1   ')

        expect(result.type).to.equal('command')
        if (result.type === 'command') {
          expect(result.command).to.equal('cmd')
          expect(result.args).to.deep.equal(['arg1'])
        }
      })
    })

    describe('prompt type parsing', () => {
      it('should parse regular text prompts', () => {
        const result = parseInput('What is the weather?')

        expect(result.type).to.equal('prompt')
        expect(result.rawInput).to.equal('What is the weather?')
      })

      it('should preserve original input for prompts (not trimmed)', () => {
        const result = parseInput('  prompt with spaces  ')

        expect(result.type).to.equal('prompt')
        expect(result.rawInput).to.equal('  prompt with spaces  ')
      })

      it('should handle prompts with special characters', () => {
        const result = parseInput('What is 2 + 2?')

        expect(result.type).to.equal('prompt')
        expect(result.rawInput).to.equal('What is 2 + 2?')
      })

      it('should handle multi-line prompts', () => {
        const result = parseInput('Line 1\nLine 2\nLine 3')

        expect(result.type).to.equal('prompt')
        expect(result.rawInput).to.equal('Line 1\nLine 2\nLine 3')
      })
    })

    describe('edge cases', () => {
      it('should handle command with only whitespace after slash', () => {
        const result = parseInput('/   ')

        expect(result.type).to.equal('command')
        if (result.type === 'command') {
          expect(result.command).to.equal('')
          expect(result.args).to.deep.equal([])
        }
      })

      it('should handle very long command names', () => {
        const longCommand = 'a'.repeat(100)
        const result = parseInput(`/${longCommand}`)

        expect(result.type).to.equal('command')
        if (result.type === 'command') {
          expect(result.command).to.equal(longCommand)
        }
      })

      it('should handle very long arguments', () => {
        const longArg = 'b'.repeat(1000)
        const result = parseInput(`/cmd ${longArg}`)

        expect(result.type).to.equal('command')
        if (result.type === 'command') {
          expect(result.command).to.equal('cmd')
          expect(result.args).to.deep.equal([longArg])
        }
      })

      it('should handle commands with special characters', () => {
        const result = parseInput('/cmd-name_123')

        expect(result.type).to.equal('command')
        if (result.type === 'command') {
          expect(result.command).to.equal('cmd-name_123')
        }
      })

      it('should handle unicode characters in commands', () => {
        const result = parseInput('/cmd 你好 🎉')

        expect(result.type).to.equal('command')
        if (result.type === 'command') {
          expect(result.command).to.equal('cmd')
          expect(result.args).to.deep.equal(['你好', '🎉'])
        }
      })
    })
  })
})
