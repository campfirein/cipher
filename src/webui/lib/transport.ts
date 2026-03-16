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

export async function connectToTransport(): Promise<ConnectResult> {
  const config = await fetchUiConfig()

  const socket = io({
    reconnection: true,
    reconnectionAttempts: 30,
    reconnectionDelay: 50,
    reconnectionDelayMax: 1000,
    transports: ['websocket'],
  })

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Connection timeout'))
    }, 5000)

    socket.on('connect', () => {
      clearTimeout(timeout)
      resolve()
    })

    socket.on('connect_error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })

  // Register as a client with projectPath so daemon can resolve project context.
  // Using 'cli' as clientType since 'webui' isn't a valid type yet.
  socket.emit(
    'client:register',
    { clientType: 'cli', projectPath: config.projectCwd },
    () => {
      // Registration acknowledged
    },
  )

  // Join the broadcast room
  socket.emit('room:join', 'broadcast-room')

  return { config, socket }
}
