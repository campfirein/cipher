import {expect} from 'chai'

import {Args, Flags, parseReplArgs, splitArgs, toCommandFlags} from '../../../../src/infra/repl/commands/arg-parser.js'

describe('arg-parser', () => {
  describe('splitArgs', () => {
    describe('basic splitting', () => {
      it('should split simple space-separated args', () => {
        const result = splitArgs('hello world')
        expect(result.args).to.deep.equal(['hello', 'world'])
        expect(result.files).to.deep.equal([])
      })

      it('should handle multiple spaces between args', () => {
        const result = splitArgs('hello    world')
        expect(result.args).to.deep.equal(['hello', 'world'])
      })

      it('should handle tabs as separators', () => {
        const result = splitArgs('hello\tworld')
        expect(result.args).to.deep.equal(['hello', 'world'])
      })

      it('should handle leading and trailing whitespace', () => {
        const result = splitArgs('  hello world  ')
        expect(result.args).to.deep.equal(['hello', 'world'])
      })

      it('should return empty arrays for empty input', () => {
        const result = splitArgs('')
        expect(result.args).to.deep.equal([])
        expect(result.files).to.deep.equal([])
      })

      it('should return empty arrays for whitespace-only input', () => {
        const result = splitArgs('   ')
        expect(result.args).to.deep.equal([])
        expect(result.files).to.deep.equal([])
      })
    })

    describe('quoted strings', () => {
      it('should keep double-quoted strings together', () => {
        const result = splitArgs('"hello world" test')
        expect(result.args).to.deep.equal(['hello world', 'test'])
      })

      it('should keep single-quoted strings together', () => {
        const result = splitArgs("'hello world' test")
        expect(result.args).to.deep.equal(['hello world', 'test'])
      })

      it('should handle quotes at the end', () => {
        const result = splitArgs('test "hello world"')
        expect(result.args).to.deep.equal(['test', 'hello world'])
      })

      it('should handle multiple quoted strings', () => {
        const result = splitArgs('"first one" "second one"')
        expect(result.args).to.deep.equal(['first one', 'second one'])
      })

      it('should handle mixed quote types', () => {
        const result = splitArgs('"double quoted" \'single quoted\'')
        expect(result.args).to.deep.equal(['double quoted', 'single quoted'])
      })

      it('should handle single quotes inside double quotes', () => {
        const result = splitArgs("\"it's a test\"")
        expect(result.args).to.deep.equal(["it's a test"])
      })

      it('should handle double quotes inside single quotes', () => {
        const result = splitArgs("'say \"hello\"'")
        expect(result.args).to.deep.equal(['say "hello"'])
      })

      it('should handle empty quoted strings (skipped)', () => {
        // Empty quoted strings are skipped (same as bash behavior)
        const result = splitArgs('"" test')
        expect(result.args).to.deep.equal(['test'])
      })

      it('should handle unclosed quotes (takes rest of string)', () => {
        const result = splitArgs('"hello world')
        expect(result.args).to.deep.equal(['hello world'])
      })
    })

    describe('file references (@filepath)', () => {
      it('should extract single file reference', () => {
        const result = splitArgs('query @src/file.ts')
        expect(result.args).to.deep.equal(['query'])
        expect(result.files).to.deep.equal(['src/file.ts'])
      })

      it('should extract multiple file references', () => {
        const result = splitArgs('@src/a.ts @src/b.ts')
        expect(result.args).to.deep.equal([])
        expect(result.files).to.deep.equal(['src/a.ts', 'src/b.ts'])
      })

      it('should handle file references with args', () => {
        const result = splitArgs('context text @src/file.ts more text')
        expect(result.args).to.deep.equal(['context', 'text', 'more', 'text'])
        expect(result.files).to.deep.equal(['src/file.ts'])
      })

      it('should handle file reference at the end', () => {
        const result = splitArgs('query @src/file.ts')
        expect(result.files).to.deep.equal(['src/file.ts'])
      })

      it('should handle file reference at the beginning', () => {
        const result = splitArgs('@src/file.ts query')
        expect(result.args).to.deep.equal(['query'])
        expect(result.files).to.deep.equal(['src/file.ts'])
      })

      it('should handle file paths with dots', () => {
        const result = splitArgs('@src/config.test.ts')
        expect(result.files).to.deep.equal(['src/config.test.ts'])
      })

      it('should handle file paths with hyphens', () => {
        const result = splitArgs('@src/my-component.tsx')
        expect(result.files).to.deep.equal(['src/my-component.tsx'])
      })

      it('should handle deep file paths', () => {
        const result = splitArgs('@src/infra/repl/commands/arg-parser.ts')
        expect(result.files).to.deep.equal(['src/infra/repl/commands/arg-parser.ts'])
      })

      it('should strip @ prefix from file references', () => {
        const result = splitArgs('@file.ts')
        expect(result.files).to.deep.equal(['file.ts'])
      })

      it('should handle @ alone as empty file reference', () => {
        const result = splitArgs('test @')
        expect(result.args).to.deep.equal(['test'])
        expect(result.files).to.deep.equal([''])
      })
    })

    describe('combined: quotes and file references', () => {
      it('should handle quoted string with file reference', () => {
        const result = splitArgs('"hello world" @src/file.ts')
        expect(result.args).to.deep.equal(['hello world'])
        expect(result.files).to.deep.equal(['src/file.ts'])
      })

      it('should handle multiple files with quoted context', () => {
        const result = splitArgs('"my context" @src/a.ts @src/b.ts')
        expect(result.args).to.deep.equal(['my context'])
        expect(result.files).to.deep.equal(['src/a.ts', 'src/b.ts'])
      })

      it('should not treat @ inside quotes as file reference', () => {
        const result = splitArgs('"email@example.com" @src/file.ts')
        expect(result.args).to.deep.equal(['email@example.com'])
        expect(result.files).to.deep.equal(['src/file.ts'])
      })

      it('should handle complex mixed input', () => {
        const result = splitArgs('query "what is this" @src/auth.ts --verbose @src/user.ts')
        expect(result.args).to.deep.equal(['query', 'what is this', '--verbose'])
        expect(result.files).to.deep.equal(['src/auth.ts', 'src/user.ts'])
      })
    })

    describe('flags handling', () => {
      it('should keep flags as regular args', () => {
        const result = splitArgs('--verbose -f test')
        expect(result.args).to.deep.equal(['--verbose', '-f', 'test'])
        expect(result.files).to.deep.equal([])
      })

      it('should handle flags with values', () => {
        const result = splitArgs('--model gpt-4 --key abc123')
        expect(result.args).to.deep.equal(['--model', 'gpt-4', '--key', 'abc123'])
      })

      it('should handle flags with file references', () => {
        const result = splitArgs('query --verbose @src/file.ts')
        expect(result.args).to.deep.equal(['query', '--verbose'])
        expect(result.files).to.deep.equal(['src/file.ts'])
      })
    })
  })

  describe('parseReplArgs', () => {
    describe('basic parsing', () => {
      it('should parse simple input without flags or args definitions', async () => {
        const result = await parseReplArgs('hello world', {})
        expect(result.argv).to.deep.equal(['hello', 'world'])
        expect(result.files).to.deep.equal([])
      })

      it('should parse with defined args', async () => {
        const result = await parseReplArgs('my-query', {
          args: {query: Args.string({description: 'Query text'})},
        })
        expect(result.args.query).to.equal('my-query')
      })

      it('should handle remaining argv when strict is false', async () => {
        const result = await parseReplArgs('first second third', {
          args: {query: Args.string()},
          strict: false,
        })
        expect(result.args.query).to.equal('first')
        expect(result.argv).to.include('second')
        expect(result.argv).to.include('third')
      })
    })

    describe('flags parsing', () => {
      it('should parse boolean flag', async () => {
        const result = await parseReplArgs('test --verbose', {
          flags: {verbose: Flags.boolean({char: 'v'})},
        })
        expect(result.flags.verbose).to.equal(true)
      })

      it('should parse boolean flag with short form', async () => {
        const result = await parseReplArgs('test -v', {
          flags: {verbose: Flags.boolean({char: 'v'})},
        })
        expect(result.flags.verbose).to.equal(true)
      })

      it('should parse string flag', async () => {
        const result = await parseReplArgs('test --model gpt-4', {
          flags: {model: Flags.string({char: 'm'})},
        })
        expect(result.flags.model).to.equal('gpt-4')
      })

      it('should parse string flag with short form', async () => {
        const result = await parseReplArgs('test -m gpt-4', {
          flags: {model: Flags.string({char: 'm'})},
        })
        expect(result.flags.model).to.equal('gpt-4')
      })

      it('should parse multiple flags', async () => {
        const result = await parseReplArgs('test --verbose --model gpt-4', {
          flags: {
            model: Flags.string({char: 'm'}),
            verbose: Flags.boolean({char: 'v'}),
          },
        })
        expect(result.flags.verbose).to.equal(true)
        expect(result.flags.model).to.equal('gpt-4')
      })

      it('should default boolean flags to false when not provided', async () => {
        const result = await parseReplArgs('test', {
          flags: {verbose: Flags.boolean({char: 'v', default: false})},
        })
        expect(result.flags.verbose).to.equal(false)
      })

      it('should return undefined for string flags when not provided', async () => {
        const result = await parseReplArgs('test', {
          flags: {model: Flags.string({char: 'm'})},
        })
        expect(result.flags.model).to.equal(undefined)
      })

      it('should support camelCase long form flags', async () => {
        const result = await parseReplArgs('test --apiKey sk-123', {
          flags: {apiKey: Flags.string({char: 'k'})},
        })
        expect(result.flags.apiKey).to.equal('sk-123')
      })

      it('should support both short and long form for same flag', async () => {
        // Short form
        const result1 = await parseReplArgs('test -k sk-short', {
          flags: {apiKey: Flags.string({char: 'k'})},
        })
        expect(result1.flags.apiKey).to.equal('sk-short')

        // Long form
        const result2 = await parseReplArgs('test --apiKey sk-long', {
          flags: {apiKey: Flags.string({char: 'k'})},
        })
        expect(result2.flags.apiKey).to.equal('sk-long')
      })
    })

    describe('file references', () => {
      it('should extract file references', async () => {
        const result = await parseReplArgs('query @src/file.ts', {})
        expect(result.argv).to.include('query')
        expect(result.files).to.deep.equal(['src/file.ts'])
      })

      it('should extract multiple file references', async () => {
        const result = await parseReplArgs('query @src/a.ts @src/b.ts', {})
        expect(result.files).to.deep.equal(['src/a.ts', 'src/b.ts'])
      })

      it('should handle files with flags', async () => {
        const result = await parseReplArgs('query --verbose @src/file.ts', {
          flags: {verbose: Flags.boolean({char: 'v'})},
        })
        expect(result.flags.verbose).to.equal(true)
        expect(result.files).to.deep.equal(['src/file.ts'])
      })

      it('should handle files with args and flags', async () => {
        const result = await parseReplArgs('my-query --verbose @src/auth.ts', {
          args: {query: Args.string()},
          flags: {verbose: Flags.boolean({char: 'v'})},
        })
        expect(result.args.query).to.equal('my-query')
        expect(result.flags.verbose).to.equal(true)
        expect(result.files).to.deep.equal(['src/auth.ts'])
      })
    })

    describe('quoted strings', () => {
      it('should handle quoted query', async () => {
        const result = await parseReplArgs('"what is authentication"', {
          args: {query: Args.string()},
        })
        expect(result.args.query).to.equal('what is authentication')
      })

      it('should handle quoted query with flags', async () => {
        const result = await parseReplArgs('"what is auth" --verbose', {
          args: {query: Args.string()},
          flags: {verbose: Flags.boolean({char: 'v'})},
        })
        expect(result.args.query).to.equal('what is auth')
        expect(result.flags.verbose).to.equal(true)
      })

      it('should handle quoted query with files', async () => {
        const result = await parseReplArgs('"explain this code" @src/auth.ts', {
          args: {query: Args.string()},
        })
        expect(result.args.query).to.equal('explain this code')
        expect(result.files).to.deep.equal(['src/auth.ts'])
      })
    })

    describe('real-world scenarios', () => {
      it('should parse /query command style input', async () => {
        const result = await parseReplArgs('how does authentication work @src/auth.ts', {
          args: {query: Args.string()},
          strict: false,
        })
        expect(result.args.query).to.equal('how')
        expect(result.argv).to.include('does')
        expect(result.argv).to.include('authentication')
        expect(result.argv).to.include('work')
        expect(result.files).to.deep.equal(['src/auth.ts'])
      })

      it('should parse /curate command style input', async () => {
        const result = await parseReplArgs('"JWT auth with 24h expiry" @src/auth/jwt.ts @src/auth/middleware.ts', {
          args: {context: Args.string()},
        })
        expect(result.args.context).to.equal('JWT auth with 24h expiry')
        expect(result.files).to.deep.equal(['src/auth/jwt.ts', 'src/auth/middleware.ts'])
      })

      it('should parse dev mode flags', async () => {
        const result = await parseReplArgs('test query -v -m gpt-4 -k sk-123', {
          flags: {
            apiKey: Flags.string({char: 'k'}),
            model: Flags.string({char: 'm'}),
            verbose: Flags.boolean({char: 'v'}),
          },
          strict: false,
        })
        expect(result.flags.verbose).to.equal(true)
        expect(result.flags.model).to.equal('gpt-4')
        expect(result.flags.apiKey).to.equal('sk-123')
      })

      it('should handle empty input', async () => {
        const result = await parseReplArgs('', {})
        expect(result.argv).to.deep.equal([])
        expect(result.files).to.deep.equal([])
      })
    })
  })

  describe('toCommandFlags', () => {
    it('should convert string flag to CommandFlag', () => {
      const flags = {
        apiKey: Flags.string({char: 'k', description: 'API key'}),
      }
      const result = toCommandFlags(flags)
      expect(result).to.deep.equal([
        {char: 'k', default: undefined, description: 'API key', name: 'apiKey', type: 'string'},
      ])
    })

    it('should convert boolean flag to CommandFlag', () => {
      const flags = {
        verbose: Flags.boolean({char: 'v', description: 'Verbose output'}),
      }
      const result = toCommandFlags(flags)
      expect(result).to.deep.equal([
        {char: 'v', default: undefined, description: 'Verbose output', name: 'verbose', type: 'boolean'},
      ])
    })

    it('should convert multiple flags', () => {
      const flags = {
        apiKey: Flags.string({char: 'k', description: 'API key'}),
        model: Flags.string({char: 'm', description: 'Model'}),
        verbose: Flags.boolean({char: 'v', description: 'Verbose'}),
      }
      const result = toCommandFlags(flags)
      expect(result).to.have.length(3)
      expect(result.map((f) => f.name)).to.deep.equal(['apiKey', 'model', 'verbose'])
    })

    it('should handle flags without char', () => {
      const flags = {
        force: Flags.boolean({description: 'Force operation'}),
      }
      const result = toCommandFlags(flags)
      expect(result[0].char).to.equal(undefined)
      expect(result[0].name).to.equal('force')
    })

    it('should handle flags with default values', () => {
      const flags = {
        verbose: Flags.boolean({char: 'v', description: 'Verbose', default: false}),
      }
      const result = toCommandFlags(flags)
      expect(result[0].default).to.equal(false)
    })

    it('should handle empty flags object', () => {
      const result = toCommandFlags({})
      expect(result).to.deep.equal([])
    })
  })
})
