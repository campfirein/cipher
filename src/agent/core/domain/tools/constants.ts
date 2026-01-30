/**
 * Known tool names.
 * These constants ensure type safety and prevent typos.
 */
export const ToolName: {
  readonly BASH_EXEC: 'bash_exec'
  readonly BASH_OUTPUT: 'bash_output'
  readonly BATCH: 'batch'
  readonly CODE_EXEC: 'code_exec'
  readonly CREATE_KNOWLEDGE_TOPIC: 'create_knowledge_topic'
  readonly CURATE: 'curate'
  readonly DELETE_MEMORY: 'delete_memory'
  readonly EDIT_FILE: 'edit_file'
  readonly EDIT_MEMORY: 'edit_memory'
  readonly GLOB_FILES: 'glob_files'
  readonly GREP_CONTENT: 'grep_content'
  readonly KILL_PROCESS: 'kill_process'
  readonly LIST_DIRECTORY: 'list_directory'
  readonly LIST_MEMORIES: 'list_memories'
  readonly READ_FILE: 'read_file'
  readonly READ_MEMORY: 'read_memory'
  readonly READ_TODOS: 'read_todos'
  readonly SEARCH_HISTORY: 'search_history'
  readonly SEARCH_KNOWLEDGE: 'search_knowledge'
  readonly SPEC_ANALYZE: 'spec_analyze'
  readonly TASK: 'task'
  readonly WRITE_FILE: 'write_file'
  readonly WRITE_MEMORY: 'write_memory'
  readonly WRITE_TODOS: 'write_todos'
} = {
  BASH_EXEC: 'bash_exec',
  BASH_OUTPUT: 'bash_output',
  BATCH: 'batch',
  CODE_EXEC: 'code_exec',
  CREATE_KNOWLEDGE_TOPIC: 'create_knowledge_topic',
  CURATE: 'curate',
  DELETE_MEMORY: 'delete_memory',
  EDIT_FILE: 'edit_file',
  EDIT_MEMORY: 'edit_memory',
  GLOB_FILES: 'glob_files',
  GREP_CONTENT: 'grep_content',
  KILL_PROCESS: 'kill_process',
  LIST_DIRECTORY: 'list_directory',
  LIST_MEMORIES: 'list_memories',
  READ_FILE: 'read_file',
  READ_MEMORY: 'read_memory',
  READ_TODOS: 'read_todos',
  SEARCH_HISTORY: 'search_history',
  SEARCH_KNOWLEDGE: 'search_knowledge',
  SPEC_ANALYZE: 'spec_analyze',
  TASK: 'task',
  WRITE_FILE: 'write_file',
  WRITE_MEMORY: 'write_memory',
  WRITE_TODOS: 'write_todos',
}

/**
 * Union type of all known tool names.
 */
export type KnownTool = (typeof ToolName)[keyof typeof ToolName]
