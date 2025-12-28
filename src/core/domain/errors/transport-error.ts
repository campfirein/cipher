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
 * Error thrown when connection to server fails.
 */
export class TransportConnectionError extends TransportError {
  public readonly originalError?: Error
  public readonly url: string

  public constructor(url: string, originalError?: Error) {
    super(`Connection failed to ${url}${originalError ? `: ${originalError.message}` : ''}`)
    this.name = 'TransportConnectionError'
    this.url = url
    this.originalError = originalError
  }
}

/**
 * Error thrown when client is not connected to server.
 */
export class TransportNotConnectedError extends TransportError {
  public constructor(operation = 'operation') {
    super(`Not connected to server. Cannot perform: ${operation}`)
    this.name = 'TransportNotConnectedError'
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

/**
 * Error thrown when room operations fail.
 */
export class TransportRoomError extends TransportError {
  public readonly operation: 'join' | 'leave'
  public readonly room: string

  public constructor(room: string, operation: 'join' | 'leave') {
    super(`Failed to ${operation} room '${room}'`)
    this.name = 'TransportRoomError'
    this.room = room
    this.operation = operation
  }
}

/**
 * Error thrown when room operation times out.
 */
export class TransportRoomTimeoutError extends TransportError {
  public readonly operation: 'join' | 'leave'
  public readonly room: string
  public readonly timeoutMs: number

  public constructor(room: string, operation: 'join' | 'leave', timeoutMs: number) {
    super(`${operation === 'join' ? 'Join' : 'Leave'} room '${room}' timed out after ${timeoutMs}ms`)
    this.name = 'TransportRoomTimeoutError'
    this.room = room
    this.operation = operation
    this.timeoutMs = timeoutMs
  }
}
