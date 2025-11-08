/**
 * Known tool names.
 * These constants ensure type safety and prevent typos.
 */
export const ToolName = {
  EDIT_FILE: 'edit_file',
  GLOB_FILES: 'glob_files',
  GREP_CONTENT: 'grep_content',
  READ_FILE: 'read_file',
  SEARCH_HISTORY: 'search_history',
  WRITE_FILE: 'write_file',
} as const

/**
 * Union type of all known tool names.
 */
export type KnownTool = (typeof ToolName)[keyof typeof ToolName]
