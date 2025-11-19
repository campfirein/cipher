/**
 * Known tool names.
 * These constants ensure type safety and prevent typos.
 */
export const ToolName: {
  readonly BASH_EXEC: 'bash_exec'
  readonly BASH_OUTPUT: 'bash_output'
  readonly CREATE_KNOWLEDGE_TOPIC: 'create_knowledge_topic'
  readonly DETECT_DOMAINS: 'detect_domains'
  readonly EDIT_FILE: 'edit_file'
  readonly GLOB_FILES: 'glob_files'
  readonly GREP_CONTENT: 'grep_content'
  readonly KILL_PROCESS: 'kill_process'
  readonly READ_FILE: 'read_file'
  readonly SEARCH_HISTORY: 'search_history'
  readonly WRITE_FILE: 'write_file'
} = {
  BASH_EXEC: 'bash_exec',
  BASH_OUTPUT: 'bash_output',
  CREATE_KNOWLEDGE_TOPIC: 'create_knowledge_topic',
  DETECT_DOMAINS: 'detect_domains',
  EDIT_FILE: 'edit_file',
  GLOB_FILES: 'glob_files',
  GREP_CONTENT: 'grep_content',
  KILL_PROCESS: 'kill_process',
  READ_FILE: 'read_file',
  SEARCH_HISTORY: 'search_history',
  WRITE_FILE: 'write_file',
}

/**
 * Union type of all known tool names.
 */
export type KnownTool = (typeof ToolName)[keyof typeof ToolName]
