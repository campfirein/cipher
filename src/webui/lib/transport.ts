/**
 * Transport bootstrap for the browser.
 *
 * Fetches /api/ui/config to discover the daemon, then connects
 * via socket.io-client on the same origin.
 */

import { io, type Socket } from 'socket.io-client'

export interface UiConfig {
  port: number
  projectCwd: string
  version: string
}

export async function fetchUiConfig(): Promise<UiConfig> {
  const response = await fetch('/api/ui/config')
  if (!response.ok) {
    throw new Error(`Failed to fetch UI config: ${response.statusText}`)
  }

  return response.json() as Promise<UiConfig>
}

interface ConnectResult {
  config: UiConfig
  socket: Socket
}

function registerClient(socket: Socket, config: UiConfig) {
  socket.emit(
    'client:register',
    { clientType: 'webui', projectPath: config.projectCwd },
    () => {
      // Registration acknowledged
    },
  )

  socket.emit('room:join', 'broadcast-room')
}

export async function connectToTransport(): Promise<ConnectResult> {
  const config = await fetchUiConfig()

  const socket = io({
    reconnection: true,
    reconnectionAttempts: 30,
    reconnectionDelay: 50,
    reconnectionDelayMax: 1000,
    transports: ['websocket'],
  })

  // Socket.IO fires "connect" after the initial handshake and after reconnects,
  // so this keeps the client/project association and broadcast room membership fresh.
  socket.on('connect', () => {
    registerClient(socket, config)
  })

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout)
      socket.off('connect', handleConnect)
      socket.off('connect_error', handleError)
    }

    const handleConnect = () => {
      cleanup()
      resolve()
    }

    const handleError = (error: Error) => {
      cleanup()
      reject(error)
    }

    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('Connection timeout'))
    }, 5000)

    socket.once('connect', handleConnect)
    socket.once('connect_error', handleError)
  })

  return { config, socket }
}
