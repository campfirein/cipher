/**
 * Error codes for key-based storage operations
 */
export enum StorageErrorCode {
  /** Batch operation failed (partial or complete) */
  BATCH_FAILED = 'BATCH_FAILED',

  /** Concurrent modification detected */
  CONCURRENT_MODIFICATION = 'CONCURRENT_MODIFICATION',

  /** Delete operation failed */
  DELETE_FAILED = 'DELETE_FAILED',

  /** Invalid key format (empty, contains invalid characters) */
  KEY_INVALID = 'KEY_INVALID',

  /** Key does not exist in storage */
  KEY_NOT_FOUND = 'KEY_NOT_FOUND',

  /** Lock acquisition timed out */
  LOCK_TIMEOUT = 'LOCK_TIMEOUT',

  /** Storage not initialized */
  NOT_INITIALIZED = 'NOT_INITIALIZED',

  /** Read operation failed */
  READ_FAILED = 'READ_FAILED',

  /** Serialization/deserialization failed */
  SERIALIZATION_FAILED = 'SERIALIZATION_FAILED',

  /** Storage backend unavailable */
  STORAGE_UNAVAILABLE = 'STORAGE_UNAVAILABLE',

  /** Write operation failed */
  WRITE_FAILED = 'WRITE_FAILED',
}

/**
 * Storage error class with factory methods for creating specific error instances.
 * Follows the same pattern as BlobError for consistency.
 */
export class StorageError extends Error {
  constructor(
    message: string,
    public readonly code: StorageErrorCode,
    public readonly details?: Record<string, unknown>,
    public readonly suggestion?: string,
  ) {
    super(message)
    this.name = 'StorageError'
  }

  /**
   * Create an error for batch operation failure.
   */
  static batchFailed(operationCount: number, cause?: Error): StorageError {
    return new StorageError(
      `Batch operation failed with ${operationCount} operations`,
      StorageErrorCode.BATCH_FAILED,
      {cause: cause?.message, operationCount},
      'Check individual operation errors and retry the batch.',
    )
  }

  /**
   * Create an error for concurrent modification.
   */
  static concurrentModification(key: readonly string[]): StorageError {
    const keyPath = key.join(':')
    return new StorageError(
      `Concurrent modification detected for: ${keyPath}`,
      StorageErrorCode.CONCURRENT_MODIFICATION,
      {key: keyPath},
      'The data was modified by another operation. Retry with fresh data.',
    )
  }

  /**
   * Create an error for delete failure.
   */
  static deleteFailed(key: readonly string[], cause?: Error): StorageError {
    const keyPath = key.join(':')
    return new StorageError(
      `Delete failed for key: ${keyPath}`,
      StorageErrorCode.DELETE_FAILED,
      {cause: cause?.message, key: keyPath},
      'Check storage permissions.',
    )
  }

  /**
   * Check if an error is a specific type of StorageError.
   */
  static isCode(error: unknown, code: StorageErrorCode): boolean {
    return error instanceof StorageError && error.code === code
  }

  /**
   * Check if an error is a StorageError.
   */
  static isStorageError(error: unknown): error is StorageError {
    return error instanceof StorageError
  }

  /**
   * Create an error for invalid key format.
   */
  static keyInvalid(key: readonly string[], reason: string): StorageError {
    const keyPath = key.join(':')
    return new StorageError(
      `Invalid key: ${keyPath} - ${reason}`,
      StorageErrorCode.KEY_INVALID,
      {key: keyPath, reason},
      'Keys must be non-empty arrays of strings without colon characters.',
    )
  }

  /**
   * Create an error for key not found.
   */
  static keyNotFound(key: readonly string[]): StorageError {
    const keyPath = key.join(':')
    return new StorageError(
      `Key not found: ${keyPath}`,
      StorageErrorCode.KEY_NOT_FOUND,
      {key: keyPath},
      'Check if the key exists using exists() before accessing.',
    )
  }

  /**
   * Create an error for lock timeout.
   */
  static lockTimeout(target: string, timeoutMs: number): StorageError {
    return new StorageError(
      `Lock acquisition timed out for: ${target} after ${timeoutMs}ms`,
      StorageErrorCode.LOCK_TIMEOUT,
      {target, timeoutMs},
      'The resource may be held by another operation. Try again later.',
    )
  }

  /**
   * Create an error for uninitialized storage.
   */
  static notInitialized(): StorageError {
    return new StorageError(
      'Storage not initialized',
      StorageErrorCode.NOT_INITIALIZED,
      undefined,
      'Call initialize() before performing any storage operations.',
    )
  }

  /**
   * Create an error for read failure.
   */
  static readFailed(key: readonly string[], cause?: Error): StorageError {
    const keyPath = key.join(':')
    return new StorageError(
      `Read failed for key: ${keyPath}`,
      StorageErrorCode.READ_FAILED,
      {cause: cause?.message, key: keyPath},
      'Check if the storage is accessible and the data is not corrupted.',
    )
  }

  /**
   * Create an error for serialization failure.
   */
  static serializationFailed(operation: 'deserialize' | 'serialize', cause?: Error): StorageError {
    return new StorageError(
      `Failed to ${operation} data`,
      StorageErrorCode.SERIALIZATION_FAILED,
      {cause: cause?.message, operation},
      operation === 'serialize'
        ? 'Ensure the data is JSON-serializable (no circular references, BigInt, etc.).'
        : 'The stored data may be corrupted or in an unexpected format.',
    )
  }

  /**
   * Create an error for unavailable storage backend.
   */
  static storageUnavailable(reason: string, cause?: Error): StorageError {
    return new StorageError(
      `Storage unavailable: ${reason}`,
      StorageErrorCode.STORAGE_UNAVAILABLE,
      {cause: cause?.message, reason},
      'Check database connection and file system access.',
    )
  }

  /**
   * Create an error for write failure.
   */
  static writeFailed(key: readonly string[], cause?: Error): StorageError {
    const keyPath = key.join(':')
    return new StorageError(
      `Write failed for key: ${keyPath}`,
      StorageErrorCode.WRITE_FAILED,
      {cause: cause?.message, key: keyPath},
      'Check storage permissions and available space.',
    )
  }
}
