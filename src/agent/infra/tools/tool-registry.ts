import type { EnvironmentContext } from '../../core/domain/environment/types.js'
import type { KnownTool } from '../../core/domain/tools/constants.js'
import type { Tool } from '../../core/domain/tools/types.js'
import type { IFileSystem } from '../../core/interfaces/i-file-system.js'
import type { IProcessService } from '../../core/interfaces/i-process-service.js'
import type { ISandboxService } from '../../core/interfaces/i-sandbox-service.js'
import type { ITodoStorage } from '../../core/interfaces/i-todo-storage.js'
import type { MemoryManager } from '../memory/memory-manager.js'
import type { ToolProviderGetter } from './tool-provider-getter.js'

import { ToolName } from '../../core/domain/tools/constants.js'
import { createCurateService } from '../sandbox/curate-service.js'
import { createCodeExecTool } from './implementations/code-exec-tool.js'
import { createCurateTool } from './implementations/curate-tool.js'
import { createGlobFilesTool } from './implementations/glob-files-tool.js'
import { createGrepContentTool } from './implementations/grep-content-tool.js'
import { createListDirectoryTool } from './implementations/list-directory-tool.js'
import { createReadFileTool } from './implementations/read-file-tool.js'
import { createSearchKnowledgeService } from './implementations/search-knowledge-service.js'
import { createSearchKnowledgeTool } from './implementations/search-knowledge-tool.js'
import { createWriteFileTool } from './implementations/write-file-tool.js'
import { ToolMarker } from './tool-markers.js'

/**
 * Service dependencies available to tools.
 * Tools declare which services they need via requiredServices.
 */
export interface ToolServices {
  /** Environment context for sandbox injection */
  environmentContext?: EnvironmentContext

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

  /** Sandbox service for code execution */
  sandboxService?: ISandboxService

  /** Todo storage service for session-based todo persistence */
  todoStorage?: ITodoStorage
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
  [ToolName.CODE_EXEC]: {
    descriptionFile: 'code_exec',
    factory({ environmentContext, fileSystemService, sandboxService }) {
      const sandbox = getRequiredService(sandboxService, 'sandboxService')

      // Inject file system service into sandbox for Tools SDK
      if (fileSystemService && sandbox.setFileSystem) {
        sandbox.setFileSystem(fileSystemService)
      }

      // Inject search knowledge service into sandbox for Tools SDK
      if (fileSystemService && sandbox.setSearchKnowledgeService) {
        const searchKnowledgeService = createSearchKnowledgeService(fileSystemService)
        sandbox.setSearchKnowledgeService(searchKnowledgeService)
      }

      // Inject curate service into sandbox for Tools SDK
      if (sandbox.setCurateService) {
        const curateService = createCurateService(environmentContext?.workingDirectory)
        sandbox.setCurateService(curateService)
      }

      // Inject environment context into sandbox for env.* access
      if (environmentContext && sandbox.setEnvironmentContext) {
        sandbox.setEnvironmentContext(environmentContext)
      }

      return createCodeExecTool(sandbox)
    },
    markers: [ToolMarker.Execution],
    requiredServices: ['sandboxService', 'fileSystemService'],
  },

  [ToolName.CURATE]: {
    descriptionFile: 'curate',
    factory: ({ environmentContext }) => createCurateTool(environmentContext?.workingDirectory),
    markers: [ToolMarker.ContextBuilding, ToolMarker.Modification],
    outputGuidance: 'curate',
    requiredServices: [], // Uses DirectoryManager and MarkdownWriter for file operations
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

  [ToolName.LIST_DIRECTORY]: {
    descriptionFile: 'list_directory',
    factory: (services) =>
      createListDirectoryTool(getRequiredService(services.fileSystemService, 'fileSystemService')),
    markers: [ToolMarker.Discovery],
    requiredServices: ['fileSystemService'],
  },

  [ToolName.READ_FILE]: {
    descriptionFile: 'read_file',
    factory: (services) => createReadFileTool(getRequiredService(services.fileSystemService, 'fileSystemService')),
    markers: [ToolMarker.Core, ToolMarker.Discovery],
    requiredServices: ['fileSystemService'],
  },

  [ToolName.SEARCH_KNOWLEDGE]: {
    descriptionFile: 'search_knowledge',
    factory: (services) =>
      createSearchKnowledgeTool(getRequiredService(services.fileSystemService, 'fileSystemService')),
    markers: [ToolMarker.ContextBuilding, ToolMarker.Discovery],
    requiredServices: ['fileSystemService'],
  },

  [ToolName.WRITE_FILE]: {
    descriptionFile: 'write_file',
    factory: (services) => createWriteFileTool(getRequiredService(services.fileSystemService, 'fileSystemService')),
    markers: [ToolMarker.Modification],
    requiredServices: ['fileSystemService'],
  },
}
