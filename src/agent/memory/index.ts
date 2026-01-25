/**
 * Cipher memory module exports
 */

// Re-export errors for convenience
export { MemoryError, MemoryErrorCode } from '../types/errors/memory-error.js';

// Re-export types for convenience
export type {
  CreateMemoryInput,
  ListMemoriesOptions,
  Memory,
  MemoryConfig,
  MemorySource,
  UpdateMemoryInput,
} from '../types/memory/types.js';

// Manager
export { MemoryManager } from './memory-manager.js';
