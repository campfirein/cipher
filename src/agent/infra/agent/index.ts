/**
 * Agent module - Complete cipher agent implementation
 *
 * This module provides the full agent architecture with:
 * - CipherAgent: Main agent class for LLM interactions
 * - BaseAgent: Abstract class with lifecycle management (start/stop/restart)
 * - Service initialization: Centralized service wiring
 * - AgentStateManager: Runtime config with session-specific overrides
 * - AgentError: Typed error factory with error codes
 * - Zod schemas: Configuration validation with defaults
 */

// Error handling
export {AgentErrorCode} from './agent-error-codes.js'
export {AgentError} from './agent-error.js'

// Schemas
export {
  AgentConfigSchema,
  BlobStorageConfigSchema,
  FileSystemConfigSchema,
  LLMConfigSchema,
  LLMUpdatesSchema,
  safeValidateAgentConfig,
  SessionConfigSchema,
  validateAgentConfig,
} from './agent-schemas.js'

// State management
export {AgentStateManager} from './agent-state-manager.js'
export type {SessionOverride} from './agent-state-manager.js'

// Base agent class
export {BaseAgent} from './base-agent.js'

// Main agent class
export {CipherAgent} from './cipher-agent.js'

// Service initialization
export {createCipherAgentServices, createSessionServices} from './service-initializer.js'
export type {ByteRoverHttpConfig, SessionLLMConfig} from './service-initializer.js'

// Re-export service types
export type {CipherAgentServices, SessionManagerConfig, SessionServices} from './service-initializer.js'

// Types
export type {
  AgentConfig,
  AgentEventSubscriber,
  AgentExecutionContext,
  BlobStorageConfig,
  FileSystemConfig,
  LLMConfig,
  LLMUpdates,
  SessionConfig,
  TerminationReason,
  ValidatedAgentConfig,
  ValidatedBlobStorageConfig,
  ValidatedFileSystemConfig,
  ValidatedLLMConfig,
  ValidatedSessionConfig,
} from './types.js'
