/**
 * Known tool names.
 * These constants ensure type safety and prevent typos.
 */
export const ToolName: {
  readonly BASH_EXEC: 'bash_exec'
  readonly BASH_OUTPUT: 'bash_output'
  readonly CREATE_KNOWLEDGE_TOPIC: 'create_knowledge_topic'
  readonly DELETE_MEMORY: 'delete_memory'
  readonly DETECT_DOMAINS: 'detect_domains'
  readonly EDIT_FILE: 'edit_file'
  readonly EDIT_MEMORY: 'edit_memory'
  readonly FIND_KNOWLEDGE_TOPICS: 'find_knowledge_topics'
  readonly GLOB_FILES: 'glob_files'
  readonly GREP_CONTENT: 'grep_content'
  readonly KILL_PROCESS: 'kill_process'
  readonly LIST_MEMORIES: 'list_memories'
  readonly READ_FILE: 'read_file'
  readonly READ_MEMORY: 'read_memory'
  readonly SEARCH_HISTORY: 'search_history'
  readonly WRITE_FILE: 'write_file'
  readonly WRITE_MEMORY: 'write_memory'
} = {
  BASH_EXEC: 'bash_exec',
  BASH_OUTPUT: 'bash_output',
  CREATE_KNOWLEDGE_TOPIC: 'create_knowledge_topic',
  DELETE_MEMORY: 'delete_memory',
  DETECT_DOMAINS: 'detect_domains',
  EDIT_FILE: 'edit_file',
  EDIT_MEMORY: 'edit_memory',
  FIND_KNOWLEDGE_TOPICS: 'find_knowledge_topics',
  GLOB_FILES: 'glob_files',
  GREP_CONTENT: 'grep_content',
  KILL_PROCESS: 'kill_process',
  LIST_MEMORIES: 'list_memories',
  READ_FILE: 'read_file',
  READ_MEMORY: 'read_memory',
  SEARCH_HISTORY: 'search_history',
  WRITE_FILE: 'write_file',
  WRITE_MEMORY: 'write_memory',
}

/**
 * Union type of all known tool names.
 */
export type KnownTool = (typeof ToolName)[keyof typeof ToolName]
