import type { EnvironmentContext } from '../../core/domain/environment/types.js'
import type { KnownTool } from '../../core/domain/tools/constants.js'
import type { Tool } from '../../core/domain/tools/types.js'
import type { ICipherAgent } from '../../core/interfaces/i-cipher-agent.js'
import type { IContentGenerator } from '../../core/interfaces/i-content-generator.js'
import type { IFileSystem } from '../../core/interfaces/i-file-system.js'
import type { ILogger } from '../../core/interfaces/i-logger.js'
import type { IProcessService } from '../../core/interfaces/i-process-service.js'
import type { ISandboxService } from '../../core/interfaces/i-sandbox-service.js'
import type { ISwarmCoordinator } from '../../core/interfaces/i-swarm-coordinator.js'
import type { ITodoStorage } from '../../core/interfaces/i-todo-storage.js'
import type { ITokenizer } from '../../core/interfaces/i-tokenizer.js'
import type { AbstractGenerationQueue } from '../map/abstract-queue.js'
import type { MemoryManager } from '../memory/memory-manager.js'
import type { ToolProviderGetter } from './tool-provider-getter.js'

import { ToolName } from '../../core/domain/tools/constants.js'
import { createCurateService } from '../sandbox/curate-service.js'
import { createAgenticMapTool } from './implementations/agentic-map-tool.js'
import { createCodeExecTool } from './implementations/code-exec-tool.js'
import { createCurateTool } from './implementations/curate-tool.js'
import { createExpandKnowledgeTool } from './implementations/expand-knowledge-tool.js'
import { createGlobFilesTool } from './implementations/glob-files-tool.js'
import { createGrepContentTool } from './implementations/grep-content-tool.js'
import { createIngestResourceTool } from './implementations/ingest-resource-tool.js'
import { createListDirectoryTool } from './implementations/list-directory-tool.js'
import { createLlmMapTool } from './implementations/llm-map-tool.js'
import { createReadFileTool } from './implementations/read-file-tool.js'
import { createSearchKnowledgeService } from './implementations/search-knowledge-service.js'
import { createSearchKnowledgeTool } from './implementations/search-knowledge-tool.js'
import { createSwarmQueryTool } from './implementations/swarm-query-tool.js'
import { createWriteFileTool } from './implementations/write-file-tool.js'
import { ToolMarker } from './tool-markers.js'

/**
 * Service dependencies available to tools.
 * Tools declare which services they need via requiredServices.
 */
export interface ToolServices {
  /** Abstract generation queue for background L0/L1 abstract file generation */
  abstractQueue?: AbstractGenerationQueue

  /** Agent instance for creating sub-sessions (used by agentic_map) */
  agentInstance?: ICipherAgent

  /** Content generator for stateless LLM calls (used by llm_map) */
  contentGenerator?: IContentGenerator

  /** Environment context for sandbox injection */
  environmentContext?: EnvironmentContext

  /** File system service for file operations */
  fileSystemService?: IFileSystem

  /**
   * Lazy getter for tool provider (avoids circular dependency).
   * Used by batch tool to execute other tools.
   */
  getToolProvider?: ToolProviderGetter

  /** Logger for fail-open warnings in map tools */
  logger?: ILogger

  /** Max context tokens for ContextTreeStore τ_hard computation */
  maxContextTokens?: number

  /** Memory manager for agent memory operations */
  memoryManager?: MemoryManager

  /** Process service for command execution */
  processService?: IProcessService

  /** Sandbox service for code execution */
  sandboxService?: ISandboxService

  /** Swarm coordinator for cross-provider memory queries */
  swarmCoordinator?: ISwarmCoordinator

  /** Todo storage service for session-based todo persistence */
  todoStorage?: ITodoStorage

  /** Tokenizer for ContextTreeStore token counting */
  tokenizer?: ITokenizer
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
  [ToolName.AGENTIC_MAP]: {
    factory({agentInstance, contentGenerator, environmentContext, logger, maxContextTokens, tokenizer}) {
      const agent = getRequiredService(agentInstance, 'agentInstance')
      const workingDirectory = environmentContext?.workingDirectory ?? process.cwd()

      return createAgenticMapTool(agent, workingDirectory, {
        generator: contentGenerator,
        logger,
        maxContextTokens,
        tokenizer,
      })
    },
    markers: [ToolMarker.Execution],
    requiredServices: ['agentInstance'],
  },

  [ToolName.CODE_EXEC]: {
    descriptionFile: 'code_exec',
    factory({ abstractQueue, environmentContext, fileSystemService, sandboxService }) {
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
        const curateService = createCurateService(environmentContext?.workingDirectory, abstractQueue)
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
    factory: ({ abstractQueue, environmentContext }) =>
      createCurateTool(environmentContext?.workingDirectory, abstractQueue),
    markers: [ToolMarker.ContextBuilding, ToolMarker.Modification],
    outputGuidance: 'curate',
    requiredServices: [],
  },

  [ToolName.EXPAND_KNOWLEDGE]: {
    descriptionFile: 'expand_knowledge',
    factory: ({ environmentContext }) =>
      createExpandKnowledgeTool({ baseDirectory: environmentContext?.workingDirectory }),
    markers: [ToolMarker.Discovery],
    requiredServices: [],
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

  [ToolName.INGEST_RESOURCE]: {
    factory: ({ abstractQueue, contentGenerator, environmentContext, fileSystemService }) =>
      createIngestResourceTool({
        abstractQueue,
        baseDirectory: environmentContext?.workingDirectory,
        contentGenerator,
        fileSystem: fileSystemService,
      }),
    markers: [ToolMarker.ContextBuilding, ToolMarker.Modification],
    requiredServices: ['contentGenerator', 'fileSystemService'],
  },

  [ToolName.LIST_DIRECTORY]: {
    descriptionFile: 'list_directory',
    factory: (services) =>
      createListDirectoryTool(getRequiredService(services.fileSystemService, 'fileSystemService')),
    markers: [ToolMarker.Discovery],
    requiredServices: ['fileSystemService'],
  },

  [ToolName.LLM_MAP]: {
    factory({contentGenerator, environmentContext, logger, maxContextTokens, tokenizer}) {
      const generator = getRequiredService(contentGenerator, 'contentGenerator')
      const workingDirectory = environmentContext?.workingDirectory ?? process.cwd()

      return createLlmMapTool(generator, workingDirectory, {logger, maxContextTokens, tokenizer})
    },
    markers: [ToolMarker.Execution],
    requiredServices: ['contentGenerator'],
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

  [ToolName.SWARM_QUERY]: {
    descriptionFile: 'swarm_query',
    factory(services) {
      const coordinator = getRequiredService(services.swarmCoordinator, 'swarmCoordinator')

      return createSwarmQueryTool(coordinator)
    },
    markers: [ToolMarker.Discovery],
    requiredServices: ['swarmCoordinator'],
  },

  [ToolName.WRITE_FILE]: {
    descriptionFile: 'write_file',
    factory: (services) => createWriteFileTool(getRequiredService(services.fileSystemService, 'fileSystemService'), services.environmentContext),
    markers: [ToolMarker.Modification],
    requiredServices: ['fileSystemService'],
  },
}
