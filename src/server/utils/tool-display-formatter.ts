/**
 * Tool Display Formatter
 *
 * Utilities for formatting tool call arguments and results in a concise,
 * readable format for CLI display.
 */

/**
 * Maximum length for string values before truncation
 */
const MAX_STRING_LENGTH = 50

/**
 * Maximum total line length for formatted output
 */
const MAX_LINE_LENGTH = 100

/**
 * Format a tool call with its arguments for display.
 *
 * Creates a concise, single-line representation of a tool call:
 * - Truncates long strings with ellipsis
 * - Shows relative paths or basenames for file paths
 * - Omits undefined/null optional parameters
 * - Formats arrays and objects as summaries
 *
 * @param toolName - Name of the tool being called
 * @param args - Tool arguments object
 * @returns Formatted string like "tool_name(arg1: value1, arg2: value2)"
 *
 * @example
 * ```typescript
 * formatToolCall('read_file', { filePath: '/long/path/to/file.ts', limit: 100 })
 * // Returns: 'read_file(filePath: "file.ts", limit: 100)'
 *
 * formatToolCall('write_file', { filePath: 'test.ts', content: 'very long content...', createDirs: true })
 * // Returns: 'write_file(filePath: "test.ts", content: "very long conte...", createDirs: true)'
 * ```
 */
export function formatToolCall(toolName: string, args: Record<string, unknown>): string {
  const formattedArgs = Object.entries(args)
    .filter(([_, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}: ${formatValue(value)}`)
    .join(', ')

  const result = `${toolName}(${formattedArgs})`

  // Truncate if too long
  if (result.length > MAX_LINE_LENGTH) {
    return result.slice(0, MAX_LINE_LENGTH - 3) + '...'
  }

  return result
}

/**
 * Format a tool result for display.
 *
 * Creates a concise summary of the tool execution result:
 * - For success: shows relevant metrics (file size, match count, etc.)
 * - For errors: shows error message
 * - Truncates long values
 *
 * @param toolName - Name of the tool that was executed
 * @param success - Whether the tool execution succeeded
 * @param result - Tool result (if successful)
 * @param error - Error message (if failed)
 * @returns Formatted result string
 *
 * @example
 * ```typescript
 * formatToolResult('write_file', true, { bytesWritten: 245 })
 * // Returns: 'File written (245 bytes)'
 *
 * formatToolResult('read_file', false, undefined, 'ENOENT: no such file or directory')
 * // Returns: 'ENOENT: no such file or directory'
 * ```
 */
export function formatToolResult(
  toolName: string,
  success: boolean,
  result?: unknown,
  error?: string,
): string {
  if (!success) {
    return error ? truncateString(error, 80) : 'Unknown error'
  }

  // Tool-specific result formatting
  switch (toolName) {
    case 'edit_file': {
      return formatEditFileResult(result)
    }

    case 'glob_files': {
      return formatGlobFilesResult(result)
    }

    case 'grep_content': {
      return formatGrepContentResult(result)
    }

    case 'read_file': {
      return formatReadFileResult(result)
    }

    case 'search_history': {
      return formatSearchHistoryResult(result)
    }

    case 'write_file': {
      return formatWriteFileResult(result)
    }

    default: {
      return formatGenericResult(result)
    }
  }
}

/**
 * Format a value for display based on its type.
 *
 * @param value - Value to format
 * @returns Formatted string representation
 */
function formatValue(value: unknown): string {
  if (value === null) {
    return 'null'
  }

  if (value === undefined) {
    return 'undefined'
  }

  if (typeof value === 'string') {
    // Special handling for file paths
    if (value.includes('/') || value.includes('\\')) {
      return `"${formatPath(value)}"`
    }

    return `"${truncateString(value, MAX_STRING_LENGTH)}"`
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (Array.isArray(value)) {
    return `[${value.length} items]`
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value)
    return `{${keys.length} fields}`
  }

  return String(value)
}

/**
 * Format a file path for display.
 * Shows basename for long paths, or relative path if reasonable.
 *
 * @param path - File path to format
 * @returns Formatted path
 */
function formatPath(path: string): string {
  // If path is already short, return as-is
  if (path.length <= MAX_STRING_LENGTH) {
    return path
  }

  // Extract filename
  const parts = path.split(/[/\\]/)
  const filename = parts.at(-1) || path

  // If just filename is short enough, use it
  if (filename.length <= MAX_STRING_LENGTH) {
    return filename
  }

  // Otherwise truncate
  return truncateString(path, MAX_STRING_LENGTH)
}

/**
 * Truncate a string to a maximum length with ellipsis.
 *
 * @param str - String to truncate
 * @param maxLength - Maximum length
 * @returns Truncated string
 */
function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str
  }

  return str.slice(0, maxLength - 3) + '...'
}

// Tool-specific result formatters

function formatReadFileResult(result: unknown): string {
  if (typeof result === 'object' && result !== null) {
    const {lines} = result as Record<string, unknown>
    if (typeof lines === 'number') {
      return `Read ${lines} lines`
    }
  }

  if (typeof result === 'string') {
    const lineCount = result.split('\n').length
    const byteCount = new Blob([result]).size
    return `Read ${lineCount} lines (${byteCount} bytes)`
  }

  return 'File read successfully'
}

function formatWriteFileResult(result: unknown): string {
  if (typeof result === 'object' && result !== null) {
    const {bytesWritten: bytes} = result as Record<string, unknown>
    if (typeof bytes === 'number') {
      return `File written (${bytes} bytes)`
    }
  }

  return 'File written successfully'
}

function formatEditFileResult(result: unknown): string {
  if (typeof result === 'object' && result !== null) {
    const {changes} = result as Record<string, unknown>
    if (typeof changes === 'number') {
      return `File edited (${changes} changes)`
    }
  }

  return 'File edited successfully'
}

function formatGlobFilesResult(result: unknown): string {
  if (Array.isArray(result)) {
    return `Found ${result.length} files`
  }

  if (typeof result === 'object' && result !== null) {
    const {files} = result as Record<string, unknown>
    if (Array.isArray(files)) {
      return `Found ${files.length} files`
    }
  }

  return 'Files found'
}

function formatGrepContentResult(result: unknown): string {
  if (Array.isArray(result)) {
    return `Found ${result.length} matches`
  }

  if (typeof result === 'object' && result !== null) {
    const {matchCount: count, matches} = result as Record<string, unknown>
    if (Array.isArray(matches)) {
      return `Found ${matches.length} matches`
    }

    if (typeof count === 'number') {
      return `Found ${count} matches`
    }
  }

  return 'Matches found'
}

function formatSearchHistoryResult(result: unknown): string {
  if (Array.isArray(result)) {
    return `Found ${result.length} history items`
  }

  if (typeof result === 'object' && result !== null) {
    const {items} = result as Record<string, unknown>
    if (Array.isArray(items)) {
      return `Found ${items.length} history items`
    }
  }

  return 'History searched'
}

function formatGenericResult(result: unknown): string {
  if (result === null || result === undefined) {
    return 'Success'
  }

  if (typeof result === 'string') {
    return truncateString(result, 60)
  }

  if (typeof result === 'number' || typeof result === 'boolean') {
    return String(result)
  }

  if (Array.isArray(result)) {
    return `Returned ${result.length} items`
  }

  if (typeof result === 'object') {
    return 'Success'
  }

  return 'Success'
}
