import type {KnownTool} from '../../../core/domain/cipher/tools/constants.js'
import type {Tool} from '../../../core/domain/cipher/tools/types.js'
import type {IFileSystem} from '../../../core/interfaces/cipher/i-file-system.js'
import type {IProcessService} from '../../../core/interfaces/cipher/i-process-service.js'

import {ToolName} from '../../../core/domain/cipher/tools/constants.js'
import {createBashExecTool} from './implementations/bash-exec-tool.js'
import {createBashOutputTool} from './implementations/bash-output-tool.js'
import {createEditFileTool} from './implementations/edit-file-tool.js'
import {createGlobFilesTool} from './implementations/glob-files-tool.js'
import {createGrepContentTool} from './implementations/grep-content-tool.js'
import {createKillProcessTool} from './implementations/kill-process-tool.js'
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
 * Defines the factory and required services for each tool.
 */
export interface ToolRegistryEntry {
  /** Factory function to create the tool */
  factory: ToolFactory

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
    factory: (services) => createBashExecTool(getRequiredService(services.processService, 'processService')),
    requiredServices: ['processService'],
  },

  [ToolName.BASH_OUTPUT]: {
    factory: (services) => createBashOutputTool(getRequiredService(services.processService, 'processService')),
    requiredServices: ['processService'],
  },

  [ToolName.EDIT_FILE]: {
    factory: (services) => createEditFileTool(getRequiredService(services.fileSystemService, 'fileSystemService')),
    requiredServices: ['fileSystemService'],
  },

  [ToolName.GLOB_FILES]: {
    factory: (services) => createGlobFilesTool(getRequiredService(services.fileSystemService, 'fileSystemService')),
    requiredServices: ['fileSystemService'],
  },

  [ToolName.GREP_CONTENT]: {
    factory: (services) => createGrepContentTool(getRequiredService(services.fileSystemService, 'fileSystemService')),
    requiredServices: ['fileSystemService'],
  },

  [ToolName.KILL_PROCESS]: {
    factory: (services) => createKillProcessTool(getRequiredService(services.processService, 'processService')),
    requiredServices: ['processService'],
  },

  [ToolName.READ_FILE]: {
    factory: (services) => createReadFileTool(getRequiredService(services.fileSystemService, 'fileSystemService')),
    requiredServices: ['fileSystemService'],
  },

  [ToolName.SEARCH_HISTORY]: {
    factory: (_services) => createSearchHistoryTool(),
    requiredServices: [], // No services required yet (stub implementation)
  },

  [ToolName.WRITE_FILE]: {
    factory: (services) => createWriteFileTool(getRequiredService(services.fileSystemService, 'fileSystemService')),
    requiredServices: ['fileSystemService'],
  },
}
