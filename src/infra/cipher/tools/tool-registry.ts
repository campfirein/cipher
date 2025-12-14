import type {KnownTool} from '../../../core/domain/cipher/tools/constants.js'
import type {Tool} from '../../../core/domain/cipher/tools/types.js'
import type {IFileSystem} from '../../../core/interfaces/cipher/i-file-system.js'
import type {IProcessService} from '../../../core/interfaces/cipher/i-process-service.js'
import type {IToolProvider} from '../../../core/interfaces/cipher/i-tool-provider.js'
import type {MemoryManager} from '../memory/memory-manager.js'

import {ToolName} from '../../../core/domain/cipher/tools/constants.js'
import {createBashExecTool} from './implementations/bash-exec-tool.js'
import {createBashOutputTool} from './implementations/bash-output-tool.js'
import {createBatchTool} from './implementations/batch-tool.js'
import {createCreateKnowledgeTopicTool} from './implementations/create-knowledge-topic-tool.js'
import {createCurateTool} from './implementations/curate-tool.js'
import {createDeleteMemoryTool} from './implementations/delete-memory-tool.js'
import {createDetectDomainsTool} from './implementations/detect-domains-tool.js'
import {createEditFileTool} from './implementations/edit-file-tool.js'
import {createEditMemoryTool} from './implementations/edit-memory-tool.js'
import {createFindKnowledgeTopicsTool} from './implementations/find-knowledge-topics-tool.js'
import {createGlobFilesTool} from './implementations/glob-files-tool.js'
import {createGrepContentTool} from './implementations/grep-content-tool.js'
import {createKillProcessTool} from './implementations/kill-process-tool.js'
import {createListMemoriesTool} from './implementations/list-memories-tool.js'
import {createReadFileTool} from './implementations/read-file-tool.js'
import {createReadMemoryTool} from './implementations/read-memory-tool.js'
import {createSearchHistoryTool} from './implementations/search-history-tool.js'
import {createWriteFileTool} from './implementations/write-file-tool.js'
import {createWriteMemoryTool} from './implementations/write-memory-tool.js'
import {createWriteTodosTool} from './implementations/write-todos-tool.js'
import {ToolMarker} from './tool-markers.js'

/**
 * Lazy getter for ToolProvider to avoid circular dependencies.
 * Used by batch tool to execute other tools at runtime.
 */
export type ToolProviderGetter = () => IToolProvider

/**
 * Service dependencies available to tools.
 * Tools declare which services they need via requiredServices.
 */
export interface ToolServices {

  /** File system service for file operations */
  fileSystemService?: IFileSystem

  /**
   * Lazy getter for tool provider (avoids circular dependency).
   * Used by batch tool to execute other tools.
   */
  getToolProvider?: ToolProviderGetter

  /** Memory manager for agent memory operations */
  memoryManager?: MemoryManager

  /** Process service for command execution */
  processService?: IProcessService
}

/**
 * Tool factory function type.
 * Creates a tool instance given the required services.
 */
export type ToolFactory = (services: ToolServices) => Tool

/**
 * Registry entry for a tool.
 * Defines the factory, required services, semantic markers, and optional output guidance for each tool.
 */
export interface ToolRegistryEntry {
  /**
   * Optional external description file name (without .txt extension).
   * If specified, the ToolProvider will load the description from
   * src/resources/tools/{descriptionFile}.txt instead of using the inline description.
   * Example: 'bash_exec' will load from 'src/resources/tools/bash_exec.txt'
   */
  descriptionFile?: string

  /** Factory function to create the tool */
  factory: ToolFactory

  /** Semantic markers for this tool (enables smart filtering and conditional prompts) */
  markers: readonly ToolMarker[]

  /**
   * Optional output guidance prompt key.
   * If specified, the ToolProvider will append guidance from tool-outputs.yml
   * after tool execution to help the LLM understand next steps.
   * Example: 'write_memory' will load the 'write_memory_output' prompt.
   */
  outputGuidance?: string

  /** Services required by this tool */
  requiredServices: readonly (keyof ToolServices)[]
}

/**
 * Helper function to safely retrieve a required service.
 * Throws a descriptive error if the service is not available.
 *
 * @param service - The service to retrieve
 * @param serviceName - Name of the service for error messages
 * @returns The service if available
 * @throws Error if service is undefined
 */
function getRequiredService<T>(service: T | undefined, serviceName: string): T {
  if (!service) {
    throw new Error(`Required service '${serviceName}' is not available. This is a bug.`)
  }

  return service
}

/**
 * Central registry of all tools.
 * Maps tool names to their factory functions and required services.
 *
 * To add a new tool:
 * 1. Add tool name to ToolName constants
 * 2. Create tool implementation file
 * 3. Add entry to this registry
 */
export const TOOL_REGISTRY: Record<KnownTool, ToolRegistryEntry> = {
  [ToolName.BASH_EXEC]: {
    descriptionFile: 'bash_exec',
    factory: (services) => createBashExecTool(getRequiredService(services.processService, 'processService')),
    markers: [ToolMarker.Execution],
    requiredServices: ['processService'],
  },

  [ToolName.BASH_OUTPUT]: {
    descriptionFile: 'bash_output',
    factory: (services) => createBashOutputTool(getRequiredService(services.processService, 'processService')),
    markers: [ToolMarker.Execution, ToolMarker.Optional],
    requiredServices: ['processService'],
  },

  [ToolName.BATCH]: {
    descriptionFile: 'batch',
    factory: (services) => createBatchTool(getRequiredService(services.getToolProvider, 'getToolProvider')),
    markers: [ToolMarker.Execution, ToolMarker.Core],
    requiredServices: ['getToolProvider'],
  },

  [ToolName.CREATE_KNOWLEDGE_TOPIC]: {
    descriptionFile: 'create_knowledge_topic',
    factory: () => createCreateKnowledgeTopicTool(),
    markers: [ToolMarker.ContextBuilding],
    outputGuidance: 'create_knowledge_topic',
    requiredServices: [], // Uses DirectoryManager for file operations
  },

  [ToolName.CURATE]: {
    descriptionFile: 'curate',
    factory: () => createCurateTool(),
    markers: [ToolMarker.ContextBuilding, ToolMarker.Modification],
    outputGuidance: 'curate',
    requiredServices: [], // Uses DirectoryManager and MarkdownWriter for file operations
  },

  [ToolName.DELETE_MEMORY]: {
    descriptionFile: 'delete_memory',
    factory: (services) => createDeleteMemoryTool(getRequiredService(services.memoryManager, 'memoryManager')),
    markers: [ToolMarker.ContextBuilding],
    outputGuidance: 'delete_memory',
    requiredServices: ['memoryManager'],
  },

  [ToolName.DETECT_DOMAINS]: {
    descriptionFile: 'detect_domains',
    factory: () => createDetectDomainsTool(),
    markers: [ToolMarker.ContextBuilding],
    outputGuidance: 'detect_domains',
    requiredServices: [], // No services required (validates LLM-detected domains)
  },

  [ToolName.EDIT_FILE]: {
    descriptionFile: 'edit_file',
    factory: (services) => createEditFileTool(getRequiredService(services.fileSystemService, 'fileSystemService')),
    markers: [ToolMarker.Modification],
    requiredServices: ['fileSystemService'],
  },

  [ToolName.EDIT_MEMORY]: {
    descriptionFile: 'edit_memory',
    factory: (services) => createEditMemoryTool(getRequiredService(services.memoryManager, 'memoryManager')),
    markers: [ToolMarker.ContextBuilding],
    outputGuidance: 'edit_memory',
    requiredServices: ['memoryManager'],
  },

  [ToolName.FIND_KNOWLEDGE_TOPICS]: {
    descriptionFile: 'find_knowledge_topics',
    factory: () => createFindKnowledgeTopicsTool(),
    markers: [ToolMarker.ContextBuilding, ToolMarker.Discovery],
    outputGuidance: 'find_knowledge_topics',
    requiredServices: [], // Uses DirectoryManager for file operations
  },

  [ToolName.GLOB_FILES]: {
    descriptionFile: 'glob_files',
    factory: (services) => createGlobFilesTool(getRequiredService(services.fileSystemService, 'fileSystemService')),
    markers: [ToolMarker.Core, ToolMarker.Discovery],
    requiredServices: ['fileSystemService'],
  },

  [ToolName.GREP_CONTENT]: {
    descriptionFile: 'grep_content',
    factory: (services) => createGrepContentTool(getRequiredService(services.fileSystemService, 'fileSystemService')),
    markers: [ToolMarker.Core, ToolMarker.Discovery],
    requiredServices: ['fileSystemService'],
  },

  [ToolName.KILL_PROCESS]: {
    descriptionFile: 'kill_process',
    factory: (services) => createKillProcessTool(getRequiredService(services.processService, 'processService')),
    markers: [ToolMarker.Execution, ToolMarker.Optional],
    requiredServices: ['processService'],
  },

  [ToolName.LIST_MEMORIES]: {
    descriptionFile: 'list_memories',
    factory: (services) => createListMemoriesTool(getRequiredService(services.memoryManager, 'memoryManager')),
    markers: [ToolMarker.ContextBuilding, ToolMarker.Discovery],
    outputGuidance: 'list_memories',
    requiredServices: ['memoryManager'],
  },

  [ToolName.READ_FILE]: {
    descriptionFile: 'read_file',
    factory: (services) => createReadFileTool(getRequiredService(services.fileSystemService, 'fileSystemService')),
    markers: [ToolMarker.Core, ToolMarker.Discovery],
    requiredServices: ['fileSystemService'],
  },

  [ToolName.READ_MEMORY]: {
    descriptionFile: 'read_memory',
    factory: (services) => createReadMemoryTool(getRequiredService(services.memoryManager, 'memoryManager')),
    markers: [ToolMarker.ContextBuilding, ToolMarker.Discovery],
    outputGuidance: 'read_memory',
    requiredServices: ['memoryManager'],
  },

  [ToolName.SEARCH_HISTORY]: {
    descriptionFile: 'search_history',
    factory: (_services) => createSearchHistoryTool(),
    markers: [ToolMarker.ContextBuilding, ToolMarker.Discovery],
    requiredServices: [], // No services required yet (stub implementation)
  },

  [ToolName.WRITE_FILE]: {
    descriptionFile: 'write_file',
    factory: (services) => createWriteFileTool(getRequiredService(services.fileSystemService, 'fileSystemService')),
    markers: [ToolMarker.Modification],
    requiredServices: ['fileSystemService'],
  },

  [ToolName.WRITE_MEMORY]: {
    descriptionFile: 'write_memory',
    factory: (services) => createWriteMemoryTool(getRequiredService(services.memoryManager, 'memoryManager')),
    markers: [ToolMarker.ContextBuilding],
    outputGuidance: 'write_memory',
    requiredServices: ['memoryManager'],
  },

  [ToolName.WRITE_TODOS]: {
    descriptionFile: 'write_todos',
    factory: () => createWriteTodosTool(),
    markers: [ToolMarker.Planning, ToolMarker.Core],
    requiredServices: [], // No services required (stateless tool)
  },
}
