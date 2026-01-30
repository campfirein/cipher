/**
 * Memory error class with factory methods for creating specific error instances
 */
/**
 * Error codes for memory operations
 */
export enum MemoryErrorCode {
  // General errors
  MEMORY_ALREADY_EXISTS = 'MEMORY_ALREADY_EXISTS',
  MEMORY_CONTENT_REQUIRED = 'MEMORY_CONTENT_REQUIRED',
  MEMORY_CONTENT_TOO_LONG = 'MEMORY_CONTENT_TOO_LONG',
  MEMORY_DELETE_ERROR = 'MEMORY_DELETE_ERROR',
  MEMORY_INVALID_ID = 'MEMORY_INVALID_ID',
  MEMORY_INVALID_TAGS = 'MEMORY_INVALID_TAGS',
  MEMORY_NOT_FOUND = 'MEMORY_NOT_FOUND',

  // Storage errors
  MEMORY_RETRIEVAL_ERROR = 'MEMORY_RETRIEVAL_ERROR',
  MEMORY_STORAGE_ERROR = 'MEMORY_STORAGE_ERROR',
}

/**
 * Memory error class with factory methods for creating specific error instances
 */
export class MemoryError extends Error {
  constructor(
    message: string,
    public readonly code: MemoryErrorCode,
    public readonly details?: Record<string, unknown>,
    public readonly suggestion?: string,
  ) {
    super(message);
    this.name = 'MemoryError';
  }

  static alreadyExists(id: string): MemoryError {
    return new MemoryError(
      `Memory already exists: ${id}`,
      MemoryErrorCode.MEMORY_ALREADY_EXISTS,
      { id },
      'Use update() to modify existing memory or delete() first before creating a new one.',
    );
  }

  static contentRequired(): MemoryError {
    return new MemoryError(
      'Memory content is required',
      MemoryErrorCode.MEMORY_CONTENT_REQUIRED,
      undefined,
      'Provide a non-empty content string when creating or updating a memory.',
    );
  }

  static contentTooLong(length: number, maxLength: number): MemoryError {
    return new MemoryError(
      `Memory content too long: ${length} characters (max: ${maxLength})`,
      MemoryErrorCode.MEMORY_CONTENT_TOO_LONG,
      { length, maxLength },
      `Reduce the content to ${maxLength} characters or less.`,
    );
  }

  static deleteError(message: string, cause?: Error): MemoryError {
    return new MemoryError(
      `Memory deletion error: ${message}`,
      MemoryErrorCode.MEMORY_DELETE_ERROR,
      { cause },
      'Check if the memory file exists and you have write permissions.',
    );
  }

  static invalidId(id: unknown): MemoryError {
    return new MemoryError(
      `Invalid memory ID: ${String(id)}`,
      MemoryErrorCode.MEMORY_INVALID_ID,
      { id },
      'Provide a valid non-empty string as the memory ID.',
    );
  }

  static invalidTags(tags: unknown): MemoryError {
    return new MemoryError(
      `Invalid tags format: ${JSON.stringify(tags)}`,
      MemoryErrorCode.MEMORY_INVALID_TAGS,
      { tags },
      'Tags must be an array of strings, each 1-50 characters long, with a maximum of 10 tags.',
    );
  }

  static notFound(id: string): MemoryError {
    return new MemoryError(
      `Memory not found: ${id}`,
      MemoryErrorCode.MEMORY_NOT_FOUND,
      { id },
      'Check if the memory ID is correct or use list() to find available memories.',
    );
  }

  static retrievalError(message: string, cause?: Error): MemoryError {
    return new MemoryError(
      `Memory retrieval error: ${message}`,
      MemoryErrorCode.MEMORY_RETRIEVAL_ERROR,
      { cause },
      'Check if the memory storage is accessible and readable.',
    );
  }

  static storageError(message: string, cause?: Error): MemoryError {
    return new MemoryError(
      `Memory storage error: ${message}`,
      MemoryErrorCode.MEMORY_STORAGE_ERROR,
      { cause },
      'Check if the storage directory exists and you have write permissions.',
    );
  }
}
