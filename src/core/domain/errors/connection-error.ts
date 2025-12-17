/**
 * Base error for client connection failures.
 */
export class ConnectionError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'ConnectionError'
  }
}

/**
 * Error thrown when no running instance is found.
 */
export class NoInstanceRunningError extends ConnectionError {
  public constructor() {
    super('No ByteRover instance is running. Start one with: brv start')
    this.name = 'NoInstanceRunningError'
  }
}

/**
 * Error thrown when instance is found but process has crashed.
 */
export class InstanceCrashedError extends ConnectionError {
  public constructor(projectRoot?: string) {
    const details = projectRoot ? ` in ${projectRoot}` : ''
    super(`ByteRover instance${details} has crashed. Please restart with: brv start`)
    this.name = 'InstanceCrashedError'
  }
}

/**
 * Error thrown when connection to instance fails.
 */
export class ConnectionFailedError extends ConnectionError {
  public readonly originalError?: Error
  public readonly port?: number

  public constructor(port?: number, originalError?: Error) {
    const portInfo = port ? ` on port ${port}` : ''
    const errorInfo = originalError ? `: ${originalError.message}` : ''
    super(`Failed to connect to ByteRover instance${portInfo}${errorInfo}`)
    this.name = 'ConnectionFailedError'
    this.port = port
    this.originalError = originalError
  }
}

/**
 * Error thrown when connection times out.
 */
export class ConnectionTimeoutError extends ConnectionError {
  public readonly timeoutMs: number

  public constructor(timeoutMs: number) {
    super(`Connection timed out after ${timeoutMs}ms`)
    this.name = 'ConnectionTimeoutError'
    this.timeoutMs = timeoutMs
  }
}
