/**
 * Base error for ACE operations
 */
export class AceError extends Error {
  public readonly code?: string

  public constructor(message: string, code?: string) {
    super(message)
    this.name = 'AceError'
    this.code = code
  }
}

/**
 * Error when a bullet is not found
 */
export class BulletNotFoundError extends AceError {
  public readonly bulletId: string

  public constructor(bulletId: string) {
    super(`Bullet not found: ${bulletId}`, 'BULLET_NOT_FOUND')
    this.name = 'BulletNotFoundError'
    this.bulletId = bulletId
  }
}

/**
 * Error when a playbook is not found
 */
export class PlaybookNotFoundError extends AceError {
  public readonly playbookPath: string

  public constructor(playbookPath: string) {
    super(`Playbook not found: ${playbookPath}`, 'PLAYBOOK_NOT_FOUND')
    this.name = 'PlaybookNotFoundError'
    this.playbookPath = playbookPath
  }
}

/**
 * Error when delta operation fails
 */
export class DeltaOperationError extends AceError {
  public readonly operation: string

  public constructor(operation: string, message: string) {
    super(`Delta operation failed (${operation}): ${message}`, 'DELTA_OPERATION_FAILED')
    this.name = 'DeltaOperationError'
    this.operation = operation
  }
}

/**
 * Error when playbook validation fails
 */
export class PlaybookValidationError extends AceError {
  public constructor(message: string) {
    super(`Playbook validation failed: ${message}`, 'PLAYBOOK_VALIDATION_FAILED')
    this.name = 'PlaybookValidationError'
  }
}
