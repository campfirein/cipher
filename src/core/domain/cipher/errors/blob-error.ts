/**
 * Error codes for blob storage operations
 */
export enum BlobErrorCode {
  BLOB_ALREADY_EXISTS = 'BLOB_ALREADY_EXISTS',
  BLOB_DELETE_ERROR = 'BLOB_DELETE_ERROR',
  BLOB_INITIALIZATION_ERROR = 'BLOB_INITIALIZATION_ERROR',
  BLOB_INVALID_CONTENT = 'BLOB_INVALID_CONTENT',
  BLOB_INVALID_KEY = 'BLOB_INVALID_KEY',
  // Blob errors
  BLOB_NOT_FOUND = 'BLOB_NOT_FOUND',

  // State errors
  BLOB_NOT_INITIALIZED = 'BLOB_NOT_INITIALIZED',
  BLOB_RETRIEVAL_ERROR = 'BLOB_RETRIEVAL_ERROR',
  // Storage operation errors
  BLOB_STORAGE_ERROR = 'BLOB_STORAGE_ERROR',
  BLOB_TOO_LARGE = 'BLOB_TOO_LARGE',

  BLOB_TOTAL_SIZE_EXCEEDED = 'BLOB_TOTAL_SIZE_EXCEEDED',
}

/**
 * Blob error class with factory methods for creating specific error instances
 */
export class BlobError extends Error {
  constructor(
    message: string,
    public readonly code: BlobErrorCode,
    public readonly details?: Record<string, unknown>,
    public readonly suggestion?: string,
  ) {
    super(message);
    this.name = 'BlobError';
  }

  static alreadyExists(key: string): BlobError {
    return new BlobError(
      `Blob already exists: ${key}`,
      BlobErrorCode.BLOB_ALREADY_EXISTS,
      { key },
      'Use a different key or delete the existing blob first.',
    );
  }

  static deleteError(message: string, cause?: Error): BlobError {
    return new BlobError(
      `Blob deletion error: ${message}`,
      BlobErrorCode.BLOB_DELETE_ERROR,
      { cause },
      'Check if the blob file exists and you have write permissions.',
    );
  }

  static initializationError(message: string, cause?: Error): BlobError {
    return new BlobError(
      `Blob storage initialization error: ${message}`,
      BlobErrorCode.BLOB_INITIALIZATION_ERROR,
      { cause },
      'Check if the storage directory can be created and you have necessary permissions.',
    );
  }

  static invalidContent(reason: string): BlobError {
    return new BlobError(
      `Invalid blob content: ${reason}`,
      BlobErrorCode.BLOB_INVALID_CONTENT,
      { reason },
      'Provide valid Buffer or string content.',
    );
  }

  static invalidKey(key: string, reason: string): BlobError {
    return new BlobError(
      `Invalid blob key: ${key} - ${reason}`,
      BlobErrorCode.BLOB_INVALID_KEY,
      { key, reason },
      'Use only alphanumeric characters, hyphens, and underscores in blob keys.',
    );
  }

  static notFound(key: string): BlobError {
    return new BlobError(
      `Blob not found: ${key}`,
      BlobErrorCode.BLOB_NOT_FOUND,
      { key },
      'Check if the blob key is correct or use list() to find available blobs.',
    );
  }

  static notInitialized(): BlobError {
    return new BlobError(
      'Blob storage not initialized',
      BlobErrorCode.BLOB_NOT_INITIALIZED,
      undefined,
      'Call initialize() before performing any blob operations.',
    );
  }

  static retrievalError(message: string, cause?: Error): BlobError {
    return new BlobError(
      `Blob retrieval error: ${message}`,
      BlobErrorCode.BLOB_RETRIEVAL_ERROR,
      { cause },
      'Check if the blob storage is accessible and readable.',
    );
  }

  static storageError(message: string, cause?: Error): BlobError {
    return new BlobError(
      `Blob storage error: ${message}`,
      BlobErrorCode.BLOB_STORAGE_ERROR,
      { cause },
      'Check if the storage directory exists and you have write permissions.',
    );
  }

  static tooLarge(size: number, maxSize: number): BlobError {
    return new BlobError(
      `Blob too large: ${size} bytes exceeds maximum ${maxSize} bytes`,
      BlobErrorCode.BLOB_TOO_LARGE,
      { maxSize, size },
      `Reduce the blob size to ${maxSize} bytes or less, or increase the maxBlobSize configuration.`,
    );
  }

  static totalSizeExceeded(
    currentSize: number,
    blobSize: number,
    maxTotalSize: number,
  ): BlobError {
    return new BlobError(
      `Total storage size exceeded: ${currentSize + blobSize} bytes would exceed maximum ${maxTotalSize} bytes`,
      BlobErrorCode.BLOB_TOTAL_SIZE_EXCEEDED,
      { blobSize, currentSize, maxTotalSize, wouldBe: currentSize + blobSize },
      'Delete some blobs to free up space or increase the maxTotalSize configuration.',
    );
  }
}
