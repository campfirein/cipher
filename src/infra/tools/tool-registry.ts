import type {KnownTool} from '../../core/domain/tools/constants.js'
import type {Tool} from '../../core/domain/tools/types.js'
import type {IFileSystem} from '../../core/interfaces/i-file-system.js'

import {ToolName} from '../../core/domain/tools/constants.js'
import {createEditFileTool} from './implementations/edit-file-tool.js'
import {createGlobFilesTool} from './implementations/glob-files-tool.js'
import {createGrepContentTool} from './implementations/grep-content-tool.js'
import {createReadFileTool} from './implementations/read-file-tool.js'
import {createSearchHistoryTool} from './implementations/search-history-tool.js'
import {createWriteFileTool} from './implementations/write-file-tool.js'

/**
 * Service dependencies available to tools.
 * Tools declare which services they need via requiredServices.
 */
export interface ToolServices {
  /** File system service for file operations */
  fileSystemService?: IFileSystem

  // Future services can be added here:
  // searchService?: ISearchService
  // processService?: IProcessService
}

/**
 * Tool factory function type.
 * Creates a tool instance given the required services.
 */
export type ToolFactory = (services: ToolServices) => Tool

/**
 * Registry entry for a tool.
 * Defines the factory and required services for each tool.
 */
export interface ToolRegistryEntry {
  /** Factory function to create the tool */
  factory: ToolFactory

  /** Services required by this tool */
  requiredServices: readonly (keyof ToolServices)[]
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
  [ToolName.EDIT_FILE]: {
    factory: (services) => createEditFileTool(services.fileSystemService!),
    requiredServices: ['fileSystemService'] as const,
  },

  [ToolName.GLOB_FILES]: {
    factory: (services) => createGlobFilesTool(services.fileSystemService!),
    requiredServices: ['fileSystemService'] as const,
  },

  [ToolName.GREP_CONTENT]: {
    factory: (services) => createGrepContentTool(services.fileSystemService!),
    requiredServices: ['fileSystemService'] as const,
  },

  [ToolName.READ_FILE]: {
    factory: (services) => createReadFileTool(services.fileSystemService!),
    requiredServices: ['fileSystemService'] as const,
  },

  [ToolName.SEARCH_HISTORY]: {
    factory: (_services) => createSearchHistoryTool(),
    requiredServices: [] as const, // No services required yet (stub implementation)
  },

  [ToolName.WRITE_FILE]: {
    factory: (services) => createWriteFileTool(services.fileSystemService!),
    requiredServices: ['fileSystemService'] as const,
  },
}
