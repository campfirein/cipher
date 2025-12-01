/**
 * Cipher memory module exports
 */

// Re-export errors for convenience
export { MemoryError, MemoryErrorCode } from '../../../core/domain/cipher/errors/memory-error.js';

// Re-export types for convenience
export type {
  CreateMemoryInput,
  ListMemoriesOptions,
  Memory,
  MemoryConfig,
  MemorySource,
  UpdateMemoryInput,
} from '../../../core/domain/cipher/memory/types.js';

// Manager
export { MemoryManager } from './memory-manager.js';
