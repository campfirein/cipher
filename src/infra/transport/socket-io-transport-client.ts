import {io, Socket} from 'socket.io-client'

import type {TransportClientConfig} from '../../core/domain/transport/types.js'
import type {
  ConnectionState,
  ConnectionStateHandler,
  EventHandler,
  ITransportClient,
  RequestOptions,
} from '../../core/interfaces/transport/index.js'

import {
  TRANSPORT_CONNECT_TIMEOUT_MS,
  TRANSPORT_DEFAULT_TRANSPORTS,
  TRANSPORT_RECONNECTION_ATTEMPTS,
  TRANSPORT_RECONNECTION_DELAY_MAX_MS,
  TRANSPORT_RECONNECTION_DELAY_MS,
  TRANSPORT_REQUEST_TIMEOUT_MS,
  TRANSPORT_ROOM_TIMEOUT_MS,
} from '../../constants.js'
import {
  TransportConnectionError,
  TransportNotConnectedError,
  TransportRequestError,
  TransportRequestTimeoutError,
  TransportRoomError,
  TransportRoomTimeoutError,
} from '../../core/domain/errors/transport-error.js'

/**
 * Wrapper type for storing event handlers with unknown types.
 * This allows us to store handlers in a Set without type assertions.
 */
type StoredEventHandler = (data: unknown) => void

/**
 * Force reconnect delays after Socket.IO gives up (exponential backoff).
 * Used when all built-in reconnection attempts fail.
 */
const FORCE_RECONNECT_DELAYS = [5000, 10_000, 20_000, 30_000, 60_000] // 5s, 10s, 20s, 30s, 60s cap

/**
 * Maximum number of force reconnect attempts before giving up.
 * After this, ProcessManager's periodic health check will detect the failure and restart.
 */
const MAX_FORCE_RECONNECT_ATTEMPTS = 10

/**
 * Socket.IO implementation of ITransportClient.
 *
 * Architecture notes:
 * - Auto-reconnects with exponential backoff
 * - Request/response uses Socket.IO acknowledgements (callbacks)
 * - Connection state is tracked and exposed via onStateChange
 * - Force reconnect after all built-in attempts fail (sleep/wake recovery)
 * - Auto-rejoins rooms after reconnect
 */
export class SocketIOTransportClient implements ITransportClient {
  private readonly config: Required<TransportClientConfig>
  private eventHandlers: Map<string, Set<StoredEventHandler>> = new Map()
  /** Track force reconnect attempt count for backoff calculation */
  private forceReconnectAttempt = 0
  /** Timer for scheduled force reconnect */
  private forceReconnectTimer?: NodeJS.Timeout
  /** Track joined rooms for auto-rejoin after reconnect */
  private joinedRooms: Set<string> = new Set()
  /** Track which events have socket listeners registered (prevents duplicates on reconnect) */
  private registeredSocketEvents: Set<string> = new Set()
  /** Store server URL for force reconnect */
  private serverUrl?: string
  private socket: Socket | undefined
  private state: ConnectionState = 'disconnected'
  private stateHandlers: Set<ConnectionStateHandler> = new Set()

  constructor(config?: TransportClientConfig) {
    this.config = {
      connectTimeoutMs: config?.connectTimeoutMs ?? TRANSPORT_CONNECT_TIMEOUT_MS,
      reconnectionAttempts: config?.reconnectionAttempts ?? TRANSPORT_RECONNECTION_ATTEMPTS,
      reconnectionDelayMaxMs: config?.reconnectionDelayMaxMs ?? TRANSPORT_RECONNECTION_DELAY_MAX_MS,
      reconnectionDelayMs: config?.reconnectionDelayMs ?? TRANSPORT_RECONNECTION_DELAY_MS,
      requestTimeoutMs: config?.requestTimeoutMs ?? TRANSPORT_REQUEST_TIMEOUT_MS,
      roomTimeoutMs: config?.roomTimeoutMs ?? TRANSPORT_ROOM_TIMEOUT_MS,
      transports: config?.transports ?? TRANSPORT_DEFAULT_TRANSPORTS,
    }
  }

  async connect(url: string): Promise<void> {
    if (this.socket?.connected) {
      return
    }

    // Cleanup existing socket if present but not connected
    // This prevents resource leaks when connect() is called again after a failed connection
    if (this.socket) {
      this.socket.removeAllListeners()
      this.socket.io.removeAllListeners()
      this.socket.disconnect()
      this.socket = undefined
      this.registeredSocketEvents.clear()
    }

    // Store URL for force reconnect
    this.serverUrl = url

    // Clear any pending force reconnect timer (we're connecting now)
    // Do NOT reset counter - connection may still fail, need to preserve backoff
    this.clearForceReconnectTimer()

    return new Promise((resolve, reject) => {
      this.setState('connecting')

      this.socket = io(url, {
        randomizationFactor: 0,
        reconnection: true,
        reconnectionAttempts: this.config.reconnectionAttempts,
        reconnectionDelay: this.config.reconnectionDelayMs,
        reconnectionDelayMax: this.config.reconnectionDelayMaxMs,
        timeout: this.config.connectTimeoutMs,
        // Use WebSocket-only by default to avoid HTTP polling issues in sandboxed environments
        transports: this.config.transports,
      })

      const onConnect = () => {
        this.setState('connected')
        cleanup()
        // Register any handlers that were added before connect() was called.
        // This fixes the issue where on() called before connect() would not
        // actually register handlers on the socket.
        this.registerPendingEventHandlers()
        resolve()
      }

      const onConnectError = (error: Error) => {
        this.setState('disconnected')
        cleanup()
        // Properly disconnect and cleanup socket to prevent leaks.
        // Without this, the socket continues attempting reconnection
        // even after we reject the promise.
        if (this.socket) {
          this.socket.removeAllListeners()
          this.socket.io.removeAllListeners()
          this.socket.disconnect()
          this.socket = undefined
        }

        reject(new TransportConnectionError(url, error))
      }

      const cleanup = () => {
        this.socket?.off('connect', onConnect)
        this.socket?.off('connect_error', onConnectError)
      }

      this.socket.on('connect', onConnect)
      this.socket.once('connect_error', onConnectError)

      // Set up persistent event handlers
      this.socket.on('disconnect', () => {
        if (this.socket?.active) {
          // Socket.IO is attempting to reconnect
          this.setState('reconnecting')
        } else {
          this.setState('disconnected')
        }
      })

      this.socket.io.on('reconnect', () => {
        this.setState('connected')
        // Re-register event handlers after reconnect
        // Clear tracking first since socket listeners were reset during reconnect
        this.registeredSocketEvents.clear()
        this.registerPendingEventHandlers()

        // Auto-rejoin rooms after reconnect
        this.rejoinRooms()
      })

      this.socket.io.on('reconnect_failed', () => {
        this.setState('disconnected')
        // Start force reconnect loop after Socket.IO gives up
        this.scheduleForceReconnect()
      })
    })
  }

  async disconnect(): Promise<void> {
    // Cancel any pending force reconnect
    this.cancelForceReconnect()

    const {socket} = this
    if (!socket) {
      return
    }

    return new Promise((resolve) => {
      // Remove all listeners to prevent memory leaks
      socket.removeAllListeners()
      socket.io.removeAllListeners()
      socket.disconnect()
      this.socket = undefined
      this.setState('disconnected')
      // Clear socket-specific tracking state to prevent leaks
      // Note: stateHandlers are NOT cleared - subscriptions persist across disconnect/connect cycles
      // Users can unsubscribe via the returned function from onStateChange()
      this.eventHandlers.clear()
      this.registeredSocketEvents.clear()
      this.joinedRooms.clear()
      resolve()
    })
  }

  getClientId(): string | undefined {
    return this.socket?.id
  }

  getState(): ConnectionState {
    return this.state
  }

  async joinRoom(room: string): Promise<void> {
    const {socket} = this
    if (!socket?.connected) {
      throw new TransportNotConnectedError('joinRoom')
    }

    return new Promise((resolve, reject) => {
      // Flag to prevent callback from executing after timeout
      let resolved = false

      const timer = setTimeout(() => {
        resolved = true
        reject(new TransportRoomTimeoutError(room, 'join', this.config.roomTimeoutMs))
      }, this.config.roomTimeoutMs)

      socket.emit('room:join', room, (response: {success: boolean}) => {
        // Don't process if timeout already fired
        if (resolved) return

        resolved = true
        clearTimeout(timer)
        if (response.success) {
          // Track joined room for auto-rejoin after reconnect
          this.joinedRooms.add(room)
          resolve()
        } else {
          reject(new TransportRoomError(room, 'join'))
        }
      })
    })
  }

  async leaveRoom(room: string): Promise<void> {
    const {socket} = this
    if (!socket?.connected) {
      throw new TransportNotConnectedError('leaveRoom')
    }

    return new Promise((resolve, reject) => {
      // Flag to prevent callback from executing after timeout
      let resolved = false

      const timer = setTimeout(() => {
        resolved = true
        reject(new TransportRoomTimeoutError(room, 'leave', this.config.roomTimeoutMs))
      }, this.config.roomTimeoutMs)

      socket.emit('room:leave', room, (response: {success: boolean}) => {
        // Don't process if timeout already fired
        if (resolved) return

        resolved = true
        clearTimeout(timer)
        if (response.success) {
          // Remove from tracked rooms
          this.joinedRooms.delete(room)
          resolve()
        } else {
          reject(new TransportRoomError(room, 'leave'))
        }
      })
    })
  }

  on<T = unknown>(event: string, handler: EventHandler<T>): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set())
    }

    // Register socket listener if connected and not already registered
    // Use registeredSocketEvents to prevent duplicates across reconnects
    this.registerSocketEventIfNeeded(event)

    // Wrap handler to match StoredEventHandler signature.
    // BOUNDARY CAST: Socket.IO delivers unknown data; caller specifies T via generic.
    // Type guard not possible for generic T at runtime.
    const wrappedHandler: StoredEventHandler = (data) => handler(data as T)
    const handlers = this.eventHandlers.get(event)
    handlers?.add(wrappedHandler)

    // Return unsubscribe function that also cleans up socket listener if no handlers remain
    return () => {
      handlers?.delete(wrappedHandler)
      // Clean up socket listener and map entry if no handlers remain
      if (handlers && handlers.size === 0) {
        this.eventHandlers.delete(event)
        this.removeSocketEventListener(event)
      }
    }
  }

  once<T = unknown>(event: string, handler: EventHandler<T>): void {
    const {socket} = this
    if (!socket) {
      throw new TransportNotConnectedError('once')
    }

    socket.once(event, handler)
  }

  /**
   * Subscribe to connection state changes.
   *
   * Important: Subscriptions persist across disconnect/connect cycles. Call the returned
   * function to unsubscribe when no longer needed to prevent memory leaks.
   *
   * @returns Unsubscribe function - call to remove the handler
   */
  onStateChange(handler: ConnectionStateHandler): () => void {
    this.stateHandlers.add(handler)
    return () => {
      this.stateHandlers.delete(handler)
    }
  }

  async request<TResponse = unknown, TRequest = unknown>(
    event: string,
    data?: TRequest,
    options?: RequestOptions,
  ): Promise<TResponse> {
    const {socket} = this
    if (!socket?.connected) {
      throw new TransportNotConnectedError('request')
    }

    const timeout = options?.timeout ?? this.config.requestTimeoutMs

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new TransportRequestTimeoutError(event, timeout))
      }, timeout)

      socket.emit(event, data, (response: {data?: TResponse; error?: string; success: boolean}) => {
        clearTimeout(timer)

        if (response.success && response.data !== undefined) {
          resolve(response.data)
        } else if (response.success) {
          // BOUNDARY CAST: Server returned success without data (void response).
          // Caller must specify TResponse=void for void endpoints.
          // Type guard not applicable - void vs non-void is a type-level distinction.
          resolve(undefined as TResponse)
        } else {
          reject(new TransportRequestError(event, response.error))
        }
      })
    })
  }

  /**
   * Attempt force reconnect after Socket.IO gives up.
   * Creates a new socket and connects.
   * Gives up after MAX_FORCE_RECONNECT_ATTEMPTS (ProcessManager will detect via periodic health check).
   */
  private async attemptForceReconnect(): Promise<void> {
    if (!this.serverUrl || this.state === 'connected') {
      return
    }

    // Check max attempts - give up if exceeded
    // ProcessManager's periodic health check (30s) will detect and restart
    if (this.forceReconnectAttempt >= MAX_FORCE_RECONNECT_ATTEMPTS) {
      this.setState('disconnected')
      return
    }

    try {
      // Cleanup old socket completely
      if (this.socket) {
        this.socket.removeAllListeners()
        this.socket.io.removeAllListeners()
        this.socket.disconnect()
        this.socket = undefined
      }

      // Reset tracking (will be re-populated on connect)
      this.registeredSocketEvents.clear()

      // Attempt to connect
      await this.connect(this.serverUrl)

      // Success - reset attempt counter
      this.forceReconnectAttempt = 0
    } catch {
      // Failed - schedule next attempt
      this.scheduleForceReconnect()
    }
  }

  /**
   * Cancel force reconnect completely (clears timer AND resets counter).
   * Used when connection is stable or on disconnect().
   */
  private cancelForceReconnect(): void {
    this.clearForceReconnectTimer()
    this.forceReconnectAttempt = 0
  }

  /**
   * Clear force reconnect timer only (does NOT reset counter).
   * Used when initiating new connection attempt - counter preserved for backoff continuity.
   */
  private clearForceReconnectTimer(): void {
    if (this.forceReconnectTimer) {
      clearTimeout(this.forceReconnectTimer)
      this.forceReconnectTimer = undefined
    }
  }

  /**
   * Register all pending event handlers on the socket.
   * Called after successful connection to handle handlers added before connect().
   */
  private registerPendingEventHandlers(): void {
    for (const event of this.eventHandlers.keys()) {
      this.registerSocketEventIfNeeded(event)
    }
  }

  /**
   * Register a socket listener for an event if not already registered.
   * Uses registeredSocketEvents set to prevent duplicates.
   */
  private registerSocketEventIfNeeded(event: string): void {
    const {socket} = this
    if (!socket || this.registeredSocketEvents.has(event)) {
      return
    }

    // Register the dispatch listener on socket
    socket.on(event, (data: unknown) => {
      const handlers = this.eventHandlers.get(event)
      if (handlers) {
        for (const h of handlers) {
          h(data)
        }
      }
    })
    this.registeredSocketEvents.add(event)
  }

  /**
   * Re-join all tracked rooms after reconnect.
   * Retries failed room joins with exponential backoff.
   */
  private rejoinRooms(): void {
    for (const room of this.joinedRooms) {
      this.rejoinRoomWithRetry(room, 0)
    }
  }

  /**
   * Rejoin a single room with retry logic.
   * Uses exponential backoff: 100ms, 200ms, 400ms (max 3 attempts).
   */
  private rejoinRoomWithRetry(room: string, attempt: number): void {
    const MAX_REJOIN_ATTEMPTS = 3
    const REJOIN_BASE_DELAY_MS = 100

    if (attempt >= MAX_REJOIN_ATTEMPTS || !this.socket?.connected) {
      return
    }

    this.socket.emit('room:join', room, (response: {success: boolean}) => {
      if (!response?.success && attempt < MAX_REJOIN_ATTEMPTS - 1) {
        // Retry with exponential backoff
        const delay = REJOIN_BASE_DELAY_MS * 2 ** attempt
        setTimeout(() => this.rejoinRoomWithRetry(room, attempt + 1), delay)
      }
    })
  }

  /**
   * Remove socket listener for an event and clear tracking.
   */
  private removeSocketEventListener(event: string): void {
    const {socket} = this
    if (socket && this.registeredSocketEvents.has(event)) {
      socket.off(event)
      this.registeredSocketEvents.delete(event)
    }
  }

  /**
   * Schedule force reconnect with exponential backoff.
   * Called after Socket.IO's built-in reconnection gives up.
   */
  private scheduleForceReconnect(): void {
    if (!this.serverUrl) {
      return
    }

    // Clear existing timer to prevent duplicate timers (fixes concurrent reconnect race)
    // This can happen when both 'connect_error' and 'reconnect_failed' schedule timers
    this.clearForceReconnectTimer()

    const delay = FORCE_RECONNECT_DELAYS[Math.min(this.forceReconnectAttempt, FORCE_RECONNECT_DELAYS.length - 1)]

    this.forceReconnectTimer = setTimeout(() => {
      this.forceReconnectAttempt++
      this.attemptForceReconnect()
    }, delay)
  }

  private setState(state: ConnectionState): void {
    if (this.state !== state) {
      this.state = state
      for (const handler of this.stateHandlers) {
        handler(state)
      }
    }
  }
}
