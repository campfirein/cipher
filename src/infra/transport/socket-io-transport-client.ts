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
 * Socket.IO implementation of ITransportClient.
 *
 * Architecture notes:
 * - Auto-reconnects with exponential backoff
 * - Request/response uses Socket.IO acknowledgements (callbacks)
 * - Connection state is tracked and exposed via onStateChange
 */
export class SocketIOTransportClient implements ITransportClient {
  private readonly config: Required<TransportClientConfig>
  private eventHandlers: Map<string, Set<StoredEventHandler>> = new Map()
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
        resolve()
      }

      const onConnectError = (error: Error) => {
        this.setState('disconnected')
        cleanup()
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
      })

      this.socket.io.on('reconnect_failed', () => {
        this.setState('disconnected')
      })
    })
  }

  async disconnect(): Promise<void> {
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
      this.eventHandlers.clear()
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
      const timer = setTimeout(() => {
        reject(new TransportRoomTimeoutError(room, 'join', this.config.roomTimeoutMs))
      }, this.config.roomTimeoutMs)

      socket.emit('room:join', room, (response: {success: boolean}) => {
        clearTimeout(timer)
        if (response.success) {
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
      const timer = setTimeout(() => {
        reject(new TransportRoomTimeoutError(room, 'leave', this.config.roomTimeoutMs))
      }, this.config.roomTimeoutMs)

      socket.emit('room:leave', room, (response: {success: boolean}) => {
        clearTimeout(timer)
        if (response.success) {
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

      // Register with socket if connected
      const {socket} = this
      if (socket) {
        socket.on(event, (data: T) => {
          const handlers = this.eventHandlers.get(event)
          if (handlers) {
            for (const h of handlers) {
              h(data)
            }
          }
        })
      }
    }

    // Wrap handler to store without type assertion
    const wrappedHandler: StoredEventHandler = (data) => handler(data as T)
    const handlers = this.eventHandlers.get(event)
    handlers?.add(wrappedHandler)

    // Return unsubscribe function
    return () => {
      handlers?.delete(wrappedHandler)
    }
  }

  once<T = unknown>(event: string, handler: EventHandler<T>): void {
    const {socket} = this
    if (!socket) {
      throw new TransportNotConnectedError('once')
    }

    socket.once(event, handler)
  }

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
          // Response success but data is undefined - resolve with undefined cast
          // This is a boundary case where server returns void
          resolve(undefined as TResponse)
        } else {
          reject(new TransportRequestError(event, response.error))
        }
      })
    })
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
