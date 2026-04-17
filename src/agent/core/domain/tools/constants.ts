/**
 * Known tool names.
 * These constants ensure type safety and prevent typos.
 */
export const ToolName: {
  readonly AGENTIC_MAP: 'agentic_map'
  readonly CODE_EXEC: 'code_exec'
  readonly CURATE: 'curate'
  readonly EXPAND_KNOWLEDGE: 'expand_knowledge'
  readonly GLOB_FILES: 'glob_files'
  readonly GREP_CONTENT: 'grep_content'
  readonly INGEST_RESOURCE: 'ingest_resource'
  readonly LIST_DIRECTORY: 'list_directory'
  readonly LLM_MAP: 'llm_map'
  readonly READ_FILE: 'read_file'
  readonly SEARCH_KNOWLEDGE: 'search_knowledge'
  readonly SWARM_QUERY: 'swarm_query'
  readonly SWARM_STORE: 'swarm_store'
  readonly WRITE_FILE: 'write_file'
} = {
  AGENTIC_MAP: 'agentic_map',
  CODE_EXEC: 'code_exec',
  CURATE: 'curate',
  EXPAND_KNOWLEDGE: 'expand_knowledge',
  GLOB_FILES: 'glob_files',
  GREP_CONTENT: 'grep_content',
  INGEST_RESOURCE: 'ingest_resource',
  LIST_DIRECTORY: 'list_directory',
  LLM_MAP: 'llm_map',
  READ_FILE: 'read_file',
  SEARCH_KNOWLEDGE: 'search_knowledge',
  SWARM_QUERY: 'swarm_query',
  SWARM_STORE: 'swarm_store',
  WRITE_FILE: 'write_file',
}

/**
 * Union type of all known tool names.
 */
export type KnownTool = (typeof ToolName)[keyof typeof ToolName]
