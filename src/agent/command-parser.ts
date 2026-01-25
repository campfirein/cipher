/**
 * Command parser for interactive CLI
 * Parses user input to distinguish between slash commands and regular prompts
 */

/**
 * Result type for parsed commands
 */
export type CommandResult =
  | {
      args?: string[]
      command?: string
      rawInput: string
      type: 'command'
    }
  | {
      rawInput: string
      type: 'prompt'
    }

/**
 * Parse user input into command or prompt
 *
 * @param input - Raw user input string
 * @returns Parsed command result (discriminated union)
 */
export function parseInput(input: string): CommandResult {
  const trimmed = input.trim()

  // Check if it's a slash command
  if (trimmed.startsWith('/')) {
    const args = parseQuotedArguments(trimmed.slice(1))
    const command = args[0] || ''
    const commandArgs = args.slice(1)

    return {
      args: commandArgs,
      command,
      rawInput: trimmed,
      type: 'command',
    }
  }

  // Regular user prompt
  return {
    rawInput: input,
    type: 'prompt',
  }
}

/**
 * Parse command arguments with support for quoted strings
 * Respects single and double quotes with escape sequences
 *
 * @param input - Command input (without leading slash)
 * @returns Array of parsed arguments
 */
function parseQuotedArguments(input: string): string[] {
  const args: string[] = []
  let current = ''
  let inQuote: '"' | '\'' | null = null
  let escaped = false

  for (const char of input) {
    if (escaped) {
      // Handle escape sequences
      current += char
      escaped = false
      continue
    }

    if (char === '\\') {
      // Start escape sequence
      escaped = true
      continue
    }

    if (inQuote) {
      // Inside quoted string
      if (char === inQuote) {
        // End quote
        inQuote = null
      } else {
        current += char
      }
    } else if (char === '"' || char === "'") {
      // Start quote
      inQuote = char
    } else if (char === ' ' || char === '\t') {
      // Whitespace - end of argument
      if (current.length > 0) {
        args.push(current)
        current = ''
      }
    } else {
      current += char
    }
  }

  // Add final argument if any
  if (current.length > 0) {
    args.push(current)
  }

  return args
}
