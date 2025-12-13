/**
 * Shared argument parser for REPL commands
 *
 * Combines shell-like string splitting with oclif's Parser for consistent
 * flag and argument handling across REPL commands.
 */

import {type Interfaces, Parser} from '@oclif/core'

import type {CommandFlag} from '../../../tui/types.js'

// Re-export Args and Flags for use by REPL commands
export {Args, Flags} from '@oclif/core'

type ArgInput = Interfaces.ArgInput
type FlagInput = Interfaces.FlagInput

/**
 * Convert oclif flag definitions to CommandFlag[] for SlashCommand.flags
 *
 * This allows defining flags once using oclif format and auto-generating
 * the CommandFlag[] needed for help display.
 *
 * @example
 * const flags = {
 *   apiKey: Flags.string({char: 'k', description: 'API key'}),
 *   verbose: Flags.boolean({char: 'v', description: 'Verbose output'}),
 * }
 *
 * export const myCommand: SlashCommand = {
 *   action(context, args) {
 *     const parsed = await parseReplArgs(args, {flags})
 *   },
 *   flags: toCommandFlags(flags),
 * }
 */
export function toCommandFlags(flags: FlagInput): CommandFlag[] {
  return Object.entries(flags).map(([name, flag]) => ({
    char: flag.char,
    default: flag.default as boolean | string | undefined,
    description: flag.description ?? '',
    name,
    type: flag.type === 'boolean' ? 'boolean' : 'string',
  }))
}

/**
 * Result from splitArgs with file references
 */
export interface SplitArgsResult {
  /** Regular arguments */
  args: string[]
  /** File references (tokens starting with @) */
  files: string[]
}

/**
 * Split a string into args array, respecting quoted strings
 * Handles both single and double quotes, and extracts @file references
 *
 * @example
 * splitArgs('"hello world" --force') // { args: ['hello world', '--force'], files: [] }
 * splitArgs("'hello world' -f") // { args: ['hello world', '-f'], files: [] }
 * splitArgs('query @src/file.ts') // { args: ['query'], files: ['src/file.ts'] }
 * splitArgs('"context" @src/a.ts @src/b.ts') // { args: ['context'], files: ['src/a.ts', 'src/b.ts'] }
 */
export function splitArgs(input: string): SplitArgsResult {
  const args: string[] = []
  const files: string[] = []
  let current = ''
  let inQuote: "'" | '"' | null = null

  for (const char of input) {
    if (inQuote) {
      // Inside a quoted string
      if (char === inQuote) {
        // End of quoted string - don't include the quote
        inQuote = null
      } else {
        current += char
      }
    } else if (char === '"' || char === "'") {
      // Start of quoted string - don't include the quote
      inQuote = char
    } else if (char === ' ' || char === '\t') {
      // Whitespace outside quotes - end current arg
      if (current) {
        if (current.startsWith('@')) {
          // File reference - strip the @ prefix
          files.push(current.slice(1))
        } else {
          args.push(current)
        }

        current = ''
      }
    } else {
      current += char
    }
  }

  // Don't forget the last arg
  if (current) {
    if (current.startsWith('@')) {
      files.push(current.slice(1))
    } else {
      args.push(current)
    }
  }

  return {args, files}
}

/**
 * Parse result from parseReplArgs
 */
export interface ParsedReplArgs<TFlags extends FlagInput, TArgs extends ArgInput> {
  /** Parsed arguments */
  args: {[K in keyof TArgs]: TArgs[K] extends {required: true} ? string : string | undefined}
  /** Remaining unparsed arguments (when strict: false) */
  argv: string[]
  /** File references extracted from @filepath tokens */
  files: string[]
  /** Parsed flags */
  flags: {[K in keyof TFlags]: TFlags[K] extends {type: 'boolean'} ? boolean : string | undefined}
}

/**
 * Parse REPL command arguments using oclif's Parser
 *
 * @param input - Raw input string from REPL (e.g., '"hello world" --force @src/file.ts')
 * @param options - Parser options
 * @param options.args - Argument definitions using Args from @oclif/core
 * @param options.flags - Flag definitions using Flags from @oclif/core
 * @param options.strict - Whether to error on unknown flags (default: false)
 * @returns Parsed flags, args, remaining argv, and file references
 *
 * @example
 * const result = await parseReplArgs('query text --verbose @src/auth.ts', {
 *   args: { query: Args.string({ required: true }) },
 *   flags: { verbose: Flags.boolean({ char: 'v' }) },
 * })
 * // result.args.query === 'query'
 * // result.flags.verbose === true
 * // result.argv === ['query', 'text']
 * // result.files === ['src/auth.ts']
 */
export async function parseReplArgs<TFlags extends FlagInput, TArgs extends ArgInput>(
  input: string,
  options: {
    args?: TArgs
    flags?: TFlags
    strict?: boolean
  },
): Promise<ParsedReplArgs<TFlags, TArgs>> {
  const {args: argv, files} = splitArgs(input)

  const result = await Parser.parse(argv, {
    args: options.args ?? ({} as TArgs),
    flags: options.flags ?? ({} as TFlags),
    strict: options.strict ?? false,
  })

  return {
    args: result.args as ParsedReplArgs<TFlags, TArgs>['args'],
    argv: result.argv as string[],
    files,
    flags: result.flags as ParsedReplArgs<TFlags, TArgs>['flags'],
  }
}
