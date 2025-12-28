/**
 * Handler for incoming client requests.
 * @param data - The request payload from client
 * @param clientId - Unique identifier of the requesting client
 * @returns Response data or void for fire-and-forget events
 */
export type RequestHandler<TRequest = unknown, TResponse = unknown> = (
  data: TRequest,
  clientId: string,
) => Promise<TResponse> | TResponse

/**
 * Connection event handler.
 * @param clientId - Unique identifier of the connected/disconnected client
 */
export type ConnectionHandler = (clientId: string) => void

/**
 * Interface for transport server operations.
 * Provides abstraction over real-time communication protocols (Socket.IO, WebSocket, etc.)
 * following Clean Architecture principles.
 *
 * The server acts as a hub that:
 * - Accepts client connections
 * - Routes requests to handlers
 * - Broadcasts events to connected clients
 */
export interface ITransportServer {
  /**
   * Adds a client to a room for targeted broadcasts.
   * @param clientId - The client to add
   * @param room - The room to join
   */
  addToRoom: (clientId: string, room: string) => void

  /**
   * Broadcasts an event to all connected clients.
   * @param event - The event name
   * @param data - The data to send
   */
  broadcast: <T = unknown>(event: string, data: T) => void

  /**
   * Broadcasts an event to clients in a specific room.
   * @param room - The room identifier
   * @param event - The event name
   * @param data - The data to send
   */
  broadcastTo: <T = unknown>(room: string, event: string, data: T) => void

  /**
   * Returns the port the server is listening on.
   * Returns undefined if server is not started.
   */
  getPort: () => number | undefined

  /**
   * Returns whether the server is currently running.
   */
  isRunning: () => boolean

  /**
   * Registers a handler for client connection events.
   * @param handler - Called when a client connects
   */
  onConnection: (handler: ConnectionHandler) => void

  /**
   * Registers a handler for client disconnection events.
   * @param handler - Called when a client disconnects
   */
  onDisconnection: (handler: ConnectionHandler) => void

  /**
   * Registers a handler for a specific event type.
   * The handler will be called when any client emits that event.
   * @param event - The event name to listen for
   * @param handler - The function to handle incoming requests
   */
  onRequest: <TRequest = unknown, TResponse = unknown>(
    event: string,
    handler: RequestHandler<TRequest, TResponse>,
  ) => void

  /**
   * Removes a client from a room.
   * @param clientId - The client to remove
   * @param room - The room to leave
   */
  removeFromRoom: (clientId: string, room: string) => void

  /**
   * Sends an event directly to a specific client.
   * @param clientId - The target client ID
   * @param event - The event name
   * @param data - The data to send
   */
  sendTo: <T = unknown>(clientId: string, event: string, data: T) => void

  /**
   * Starts the transport server on the specified port.
   * @param port - The port number to listen on
   * @throws Error if server fails to start (e.g., port in use)
   */
  start: (port: number) => Promise<void>

  /**
   * Gracefully stops the transport server.
   * Closes all client connections and releases resources.
   */
  stop: () => Promise<void>
}
