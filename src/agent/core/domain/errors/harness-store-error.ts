/**
 * Error codes for `IHarnessStore` operations.
 */
export enum HarnessStoreErrorCode {
  /**
   * `recordFeedback` was called with an `outcomeId` that does not exist
   * under the given `(projectId, commandType)` partition. Callers should
   * only flag outcomes they obtained from `listOutcomes` — a miss here
   * is a real bug, not a racy fallback.
   */
  OUTCOME_NOT_FOUND = 'OUTCOME_NOT_FOUND',

  /**
   * A version with the same `id`, or the same
   * `(projectId, commandType, version)` tuple, already exists.
   */
  VERSION_CONFLICT = 'VERSION_CONFLICT',
}

/**
 * Contract errors thrown by `IHarnessStore` implementations. Callers catch
 * this class to distinguish storage-contract violations from transport
 * failures (which surface as `StorageError` from the underlying
 * `IBlobStorage` / `IKeyStorage`).
 */
export class HarnessStoreError extends Error {
  constructor(
    message: string,
    public readonly code: HarnessStoreErrorCode,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'HarnessStoreError'
  }

  static isCode(error: unknown, code: HarnessStoreErrorCode): boolean {
    return error instanceof HarnessStoreError && error.code === code
  }

  static isHarnessStoreError(error: unknown): error is HarnessStoreError {
    return error instanceof HarnessStoreError
  }

  static outcomeNotFound(
    projectId: string,
    commandType: string,
    outcomeId: string,
  ): HarnessStoreError {
    return new HarnessStoreError(
      `Outcome not found for (${projectId}, ${commandType}): ${outcomeId}`,
      HarnessStoreErrorCode.OUTCOME_NOT_FOUND,
      {commandType, outcomeId, projectId},
    )
  }

  static versionConflict(
    projectId: string,
    commandType: string,
    details: {id?: string; version?: number},
  ): HarnessStoreError {
    return new HarnessStoreError(
      `Harness version already exists for (${projectId}, ${commandType}): ${JSON.stringify(details)}`,
      HarnessStoreErrorCode.VERSION_CONFLICT,
      {commandType, projectId, ...details},
    )
  }
}
