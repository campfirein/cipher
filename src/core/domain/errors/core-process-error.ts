/**
 * Base error for Core process failures.
 */
export class CoreProcessError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'CoreProcessError'
  }
}

/**
 * Error thrown when Core process is already running.
 */
export class CoreProcessAlreadyRunningError extends CoreProcessError {
  public constructor() {
    super('Core process is already running')
    this.name = 'CoreProcessAlreadyRunningError'
  }
}

/**
 * Error thrown when instance lock cannot be acquired.
 */
export class InstanceLockError extends CoreProcessError {
  public readonly existingPid?: number
  public readonly existingPort?: number

  public constructor(existingPid?: number, existingPort?: number) {
    const details = existingPid && existingPort ? ` (pid: ${existingPid}, port: ${existingPort})` : ''
    super(`Failed to acquire instance lock. Another instance is already running${details}`)
    this.name = 'InstanceLockError'
    this.existingPid = existingPid
    this.existingPort = existingPort
  }
}

/**
 * Error thrown when instance lock acquisition fails for unknown reason.
 */
export class InstanceLockAcquisitionError extends CoreProcessError {
  public readonly reason?: string

  public constructor(reason?: string) {
    super(`Failed to acquire instance lock${reason ? `: ${reason}` : ''}`)
    this.name = 'InstanceLockAcquisitionError'
    this.reason = reason
  }
}
