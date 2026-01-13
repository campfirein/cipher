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
import {processLog} from '../../utils/process-logger.js'

/**
 * Log transport client events for debugging reconnection issues.
 */
function clientLog(message: string): void {
  processLog(`[TransportClient] ${message}`)
}

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
 * Interval for checking time jumps that indicate system wake from sleep.
 * Uses a short interval so we detect wake quickly.
 */
const WAKE_DETECTION_INTERVAL_MS = 5000

/**
 * Time jump threshold to detect wake from sleep/hibernate.
 * If the actual elapsed time exceeds expected by this amount, system likely woke from sleep.
 */
const WAKE_TIME_JUMP_THRESHOLD_MS = 10_000

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
  /** Last time we checked for wake (for detecting time jumps) */
  private lastWakeCheckTime = Date.now()
  /** Track which events have socket listeners registered (prevents duplicates on reconnect) */
  private registeredSocketEvents: Set<string> = new Set()
  /** Store server URL for force reconnect */
  private serverUrl?: string
  private socket: Socket | undefined
  private state: ConnectionState = 'disconnected'
  private stateHandlers: Set<ConnectionStateHandler> = new Set()
  /** Timer for wake detection */
  private wakeDetectionTimer?: NodeJS.Timeout

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
        // Start wake detection to handle sleep/hibernate recovery
        this.startWakeDetection()
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
      this.socket.on('disconnect', (reason) => {
        clientLog(`Socket disconnected, reason: ${reason}, active: ${this.socket?.active}`)
        if (this.socket?.active) {
          // Socket.IO is attempting to reconnect
          this.setState('reconnecting')
        } else {
          this.setState('disconnected')
        }
      })

      this.socket.io.on('reconnect', (attemptNumber) => {
        clientLog(`Socket.IO built-in reconnect succeeded after ${attemptNumber} attempts`)
        this.setState('connected')
        // Re-register event handlers after reconnect
        // Clear tracking first since socket listeners were reset during reconnect
        this.registeredSocketEvents.clear()
        this.registerPendingEventHandlers()

        // Auto-rejoin rooms after reconnect
        // Use process.nextTick to ensure socket.connected is true
        // (reconnect event fires before socket.connected is updated)
        process.nextTick(() => this.rejoinRooms())
      })

      this.socket.io.on('reconnect_failed', () => {
        clientLog('Socket.IO built-in reconnection failed after all attempts, starting force reconnect')
        this.setState('disconnected')
        // Start force reconnect loop after Socket.IO gives up
        this.scheduleForceReconnect()
      })
    })
  }

  async disconnect(): Promise<void> {
    // Cancel any pending force reconnect
    this.cancelForceReconnect()
    // Stop wake detection
    this.stopWakeDetection()

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
      clientLog(`Force reconnect gave up after ${MAX_FORCE_RECONNECT_ATTEMPTS} attempts`)
      this.setState('disconnected')
      return
    }

    clientLog(`Force reconnect attempt ${this.forceReconnectAttempt + 1}/${MAX_FORCE_RECONNECT_ATTEMPTS}`)

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

      // Rejoin rooms after force reconnect (same as built-in reconnect)
      // Without this, TUI REPL won't receive events from broadcast-room
      // Use process.nextTick for consistency with built-in reconnect handler
      clientLog(`Force reconnect succeeded, rejoining ${this.joinedRooms.size} rooms`)
      process.nextTick(() => this.rejoinRooms())

      // Success - reset attempt counter
      this.forceReconnectAttempt = 0
    } catch (error) {
      // Failed - schedule next attempt
      const errorMsg = error instanceof Error ? error.message : String(error)
      clientLog(`Force reconnect failed: ${errorMsg}`)
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
   * Handle system wake from sleep/hibernate.
   * Re-triggers reconnection if not connected and force reconnect has given up.
   */
  private handleWakeFromSleep(): void {
    // Only take action if disconnected (force reconnect may have given up before sleep)
    if (this.state === 'disconnected' && this.serverUrl) {
      clientLog('handleWakeFromSleep: state is disconnected, restarting force reconnect')
      // Reset attempt counter to get fresh tries after wake
      this.forceReconnectAttempt = 0
      this.scheduleForceReconnect()
    } else if (this.state === 'connected' && this.socket && !this.socket.connected) {
      // State says connected but socket isn't - stale state after wake
      clientLog('handleWakeFromSleep: state mismatch (connected but socket disconnected), triggering reconnect')
      this.setState('disconnected')
      this.forceReconnectAttempt = 0
      this.scheduleForceReconnect()
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
    clientLog(`rejoinRooms: rejoining ${this.joinedRooms.size} rooms: [${[...this.joinedRooms].join(', ')}]`)
    for (const room of this.joinedRooms) {
      this.rejoinRoomWithRetry(room, 0)
    }
  }

  /**
   * Rejoin a single room with retry logic.
   * Uses exponential backoff: 50ms, 100ms, 200ms, 400ms, 800ms (max 5 attempts).
   * Retries BOTH when socket not connected AND when room:join fails.
   */
  private rejoinRoomWithRetry(room: string, attempt: number): void {
    const MAX_REJOIN_ATTEMPTS = 5
    const REJOIN_BASE_DELAY_MS = 50

    if (attempt >= MAX_REJOIN_ATTEMPTS) {
      clientLog(`rejoinRoomWithRetry: gave up rejoining '${room}' after ${MAX_REJOIN_ATTEMPTS} attempts`)
      return
    }

    // If socket not connected yet, retry with backoff (don't silent return!)
    // This handles race condition where reconnect event fires before socket.connected is true
    if (!this.socket?.connected) {
      const delay = REJOIN_BASE_DELAY_MS * 2 ** attempt
      clientLog(`rejoinRoomWithRetry: socket not connected, retrying '${room}' in ${delay}ms (attempt ${attempt + 1}/${MAX_REJOIN_ATTEMPTS})`)
      setTimeout(() => this.rejoinRoomWithRetry(room, attempt + 1), delay)
      return
    }

    clientLog(`rejoinRoomWithRetry: attempting to rejoin '${room}' (attempt ${attempt + 1}/${MAX_REJOIN_ATTEMPTS})`)
    this.socket.emit('room:join', room, (response: {success: boolean}) => {
      if (response?.success) {
        clientLog(`rejoinRoomWithRetry: successfully rejoined '${room}'`)
      } else if (attempt < MAX_REJOIN_ATTEMPTS - 1) {
        // Retry with exponential backoff
        const delay = REJOIN_BASE_DELAY_MS * 2 ** attempt
        clientLog(`rejoinRoomWithRetry: room:join failed for '${room}', retrying in ${delay}ms`)
        setTimeout(() => this.rejoinRoomWithRetry(room, attempt + 1), delay)
      } else {
        clientLog(`rejoinRoomWithRetry: failed to rejoin '${room}' on final attempt`)
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
      clientLog('scheduleForceReconnect: no serverUrl, skipping')
      return
    }

    // Clear existing timer to prevent duplicate timers (fixes concurrent reconnect race)
    // This can happen when both 'connect_error' and 'reconnect_failed' schedule timers
    this.clearForceReconnectTimer()

    const delay = FORCE_RECONNECT_DELAYS[Math.min(this.forceReconnectAttempt, FORCE_RECONNECT_DELAYS.length - 1)]
    clientLog(`scheduleForceReconnect: scheduling attempt ${this.forceReconnectAttempt + 1} in ${delay}ms`)

    this.forceReconnectTimer = setTimeout(() => {
      this.forceReconnectAttempt++
      this.attemptForceReconnect()
    }, delay)
  }

  private setState(state: ConnectionState): void {
    if (this.state !== state) {
      clientLog(`State change: ${this.state} -> ${state}`)
      this.state = state
      for (const handler of this.stateHandlers) {
        handler(state)
      }
    }
  }

  /**
   * Start wake detection timer.
   * Periodically checks for time jumps that indicate system woke from sleep.
   */
  private startWakeDetection(): void {
    this.stopWakeDetection()
    this.lastWakeCheckTime = Date.now()

    this.wakeDetectionTimer = setInterval(() => {
      const now = Date.now()
      const elapsed = now - this.lastWakeCheckTime
      this.lastWakeCheckTime = now

      // If elapsed time is much greater than interval, system likely woke from sleep
      if (elapsed > WAKE_DETECTION_INTERVAL_MS + WAKE_TIME_JUMP_THRESHOLD_MS) {
        clientLog(`Wake detected: time jump of ${elapsed}ms (expected ~${WAKE_DETECTION_INTERVAL_MS}ms)`)
        this.handleWakeFromSleep()
      }
    }, WAKE_DETECTION_INTERVAL_MS)
  }

  /**
   * Stop wake detection timer.
   */
  private stopWakeDetection(): void {
    if (this.wakeDetectionTimer) {
      clearInterval(this.wakeDetectionTimer)
      this.wakeDetectionTimer = undefined
    }
  }
}
