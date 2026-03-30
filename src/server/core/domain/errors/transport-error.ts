/**
 * Base error for transport layer failures.
 */
export class TransportError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'TransportError'
  }
}

/**
 * Error thrown when server is not started.
 */
export class TransportServerNotStartedError extends TransportError {
  public constructor(operation = 'operation') {
    super(`Server not started. Cannot perform: ${operation}`)
    this.name = 'TransportServerNotStartedError'
  }
}

/**
 * Error thrown when server is already running.
 */
export class TransportServerAlreadyRunningError extends TransportError {
  public readonly port: number

  public constructor(port: number) {
    super(`Server is already running on port ${port}`)
    this.name = 'TransportServerAlreadyRunningError'
    this.port = port
  }
}

/**
 * Error thrown when port is already in use.
 */
export class TransportPortInUseError extends TransportError {
  public readonly port: number

  public constructor(port: number) {
    super(`Port ${port} is already in use`)
    this.name = 'TransportPortInUseError'
    this.port = port
  }
}

/**
 * Error thrown when a request times out.
 */
export class TransportRequestTimeoutError extends TransportError {
  public readonly event: string
  public readonly timeoutMs: number

  public constructor(event: string, timeoutMs: number) {
    super(`Request timeout for event '${event}' after ${timeoutMs}ms`)
    this.name = 'TransportRequestTimeoutError'
    this.event = event
    this.timeoutMs = timeoutMs
  }
}

/**
 * Error thrown when a request fails with server error.
 */
export class TransportRequestError extends TransportError {
  public readonly event: string

  public constructor(event: string, message = 'Request failed') {
    super(`${message} for event '${event}'`)
    this.name = 'TransportRequestError'
    this.event = event
  }
}
