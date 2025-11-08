// Errors
export {
  ToolError,
  ToolExecutionError,
  ToolNotFoundError,
  ToolProviderNotInitializedError,
  ToolValidationError,
} from '../../core/domain/errors/tool-error.js'

// Constants
export {ToolName} from '../../core/domain/tools/constants.js'
export type {KnownTool} from '../../core/domain/tools/constants.js'

// Core types and interfaces
export type {JSONSchema7, Tool, ToolExecutionContext, ToolSet} from '../../core/domain/tools/types.js'

export type {IToolProvider} from '../../core/interfaces/i-tool-provider.js'

// Tool implementations (for direct access if needed)
export {createEditFileTool} from './implementations/edit-file-tool.js'
export {createGlobFilesTool} from './implementations/glob-files-tool.js'
export {createGrepContentTool} from './implementations/grep-content-tool.js'
export {createReadFileTool} from './implementations/read-file-tool.js'
export {createSearchHistoryTool} from './implementations/search-history-tool.js'
export {createWriteFileTool} from './implementations/write-file-tool.js'

// Registry and provider
export {ToolProvider} from './tool-provider.js'
export type {ToolFactory, ToolRegistryEntry, ToolServices} from './tool-registry.js'
export {TOOL_REGISTRY} from './tool-registry.js'

// Utilities
export {convertZodToJsonSchema} from './utils/schema-converter.js'
