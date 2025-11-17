/**
 * Tool markers for semantic classification of tools.
 *
 * Tool markers enable:
 * - Smart filtering based on operational mode (planning, execution, etc.)
 * - Conditional prompt sections based on available capabilities
 * - Context tree building workflows
 */

/**
 * Enum of available tool markers
 */
export enum ToolMarker {
  /**
   * Tools for building context trees and organizing conversation/project information
   * Examples: segment_conversation, search_history
   */
  ContextBuilding = 'ToolMarkerContextBuilding',

  /**
   * Core tools that are always needed for basic operation
   * Examples: read_file, glob_files, grep_content
   */
  Core = 'ToolMarkerCore',

  /**
   * Tools for discovering and exploring codebase structure
   * Examples: glob_files, grep_content, read_file
   */
  Discovery = 'ToolMarkerDiscovery',

  /**
   * Tools that execute external commands/processes
   * Examples: bash_exec, bash_output, kill_process
   */
  Execution = 'ToolMarkerExecution',

  /**
   * Tools that modify files
   * Examples: write_file, edit_file
   */
  Modification = 'ToolMarkerModification',

  /**
   * Optional tools that are not needed for basic operations
   * Examples: bash_output, kill_process, segment_conversation
   */
  Optional = 'ToolMarkerOptional',
}
