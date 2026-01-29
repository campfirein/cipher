/**
 * Handler for server-broadcasted events.
 * @param data - The event payload from server
 */
export type EventHandler<T = unknown> = (data: T) => void

/**
 * Connection state of the transport client.
 */
export type ConnectionState = 'connected' | 'connecting' | 'disconnected' | 'reconnecting'

/**
 * Handler for connection state changes.
 * @param state - The new connection state
 */
export type ConnectionStateHandler = (state: ConnectionState) => void

/**
 * Options for client requests.
 */
export type RequestOptions = {
  /**
   * Timeout in milliseconds for the request.
   * If not specified, uses the default timeout.
   */
  timeout?: number
}

/**
 * Interface for transport client operations.
 * Provides abstraction over real-time communication protocols (Socket.IO, WebSocket, etc.)
 * following Clean Architecture principles.
 *
 * The client:
 * - Connects to a transport server
 * - Sends requests and receives responses
 * - Listens for broadcast events
 * - Joins rooms for targeted broadcasts
 */
export interface ITransportClient {
  /**
   * Connects to the transport server at the specified URL.
   * @param url - The server URL to connect to (e.g., "http://localhost:9847")
   * @throws Error if connection fails
   */
  connect: (url: string) => Promise<void>

  /**
   * Disconnects from the transport server.
   * Cleans up resources and stops reconnection attempts.
   */
  disconnect: () => Promise<void>

  /**
   * Returns the unique client ID assigned by the server.
   * Returns undefined if not connected.
   */
  getClientId: () => string | undefined

  /**
   * Returns the current connection state.
   */
  getState: () => ConnectionState

  /**
   * Checks if the socket is actually connected and responsive.
   * Verifies bidirectional communication by sending a ping and waiting for response.
   * @param timeoutMs - Timeout in milliseconds (default: 2000)
   * @returns true if socket is connected and responsive, false otherwise
   */
  isConnected: (timeoutMs?: number) => Promise<boolean>

  /**
   * Joins a room for targeted broadcasts.
   * @param room - The room identifier to join
   */
  joinRoom: (room: string) => Promise<void>

  /**
   * Leaves a room.
   * @param room - The room identifier to leave
   */
  leaveRoom: (room: string) => Promise<void>

  /**
   * Registers a handler for a specific event from the server.
   * Multiple handlers can be registered for the same event.
   * @param event - The event name to listen for
   * @param handler - The function to handle incoming events
   * @returns A function to unsubscribe the handler
   */
  on: <T = unknown>(event: string, handler: EventHandler<T>) => () => void

  /**
   * Registers a one-time handler for a specific event.
   * The handler will be automatically removed after first invocation.
   * @param event - The event name to listen for
   * @param handler - The function to handle the event
   */
  once: <T = unknown>(event: string, handler: EventHandler<T>) => void

  /**
   * Registers a handler for connection state changes.
   * @param handler - Called when connection state changes
   * @returns A function to unsubscribe the handler
   */
  onStateChange: (handler: ConnectionStateHandler) => () => void

  /**
   * Sends a request to the server and waits for a response.
   * @param event - The event name
   * @param data - The request payload
   * @param options - Optional request configuration
   * @returns The server's response
   * @throws Error if request times out or server returns an error
   */
  request: <TResponse = unknown, TRequest = unknown>(
    event: string,
    data?: TRequest,
    options?: RequestOptions,
  ) => Promise<TResponse>
}
