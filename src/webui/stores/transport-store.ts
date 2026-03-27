/**
 * Transport Store
 *
 * Zustand store for Socket.IO connection state and BrvApiClient instance.
 * Mirror of src/tui/stores/transport-store.ts adapted for browser Socket.
 */

import type {Socket} from 'socket.io-client'

import {create} from 'zustand'

import type {UiConfig} from '../lib/transport'

import {BrvApiClient} from '../lib/api-client'

type ConnectionState = 'connected' | 'connecting' | 'disconnected' | 'reconnecting'

export interface TransportState {
  apiClient: BrvApiClient | null
  connectionState: ConnectionState
  error: Error | null
  isConnected: boolean
  projectCwd: string
  reconnectCount: number
  socket: null | Socket
  version: string
}

interface TransportActions {
  incrementReconnectCount: () => void
  reset: () => void
  setConnectionState: (state: ConnectionState) => void
  setError: (error: Error | null) => void
  setSocket: (socket: Socket, config: UiConfig) => void
}

const initialState: TransportState = {
  apiClient: null,
  connectionState: 'disconnected',
  error: null,
  isConnected: false,
  projectCwd: '',
  reconnectCount: 0,
  socket: null,
  version: '',
}

export const useTransportStore = create<TransportActions & TransportState>()((set) => ({
  ...initialState,

  incrementReconnectCount: () => set((state) => ({reconnectCount: state.reconnectCount + 1})),

  reset: () => set(initialState),

  setConnectionState: (connectionState: ConnectionState) =>
    set({
      connectionState,
      isConnected: connectionState === 'connected',
    }),

  setError: (error: Error | null) =>
    set({
      connectionState: 'disconnected',
      error,
      isConnected: false,
    }),

  setSocket: (socket: Socket, config: UiConfig) =>
    set({
      apiClient: new BrvApiClient(socket),
      connectionState: 'connected',
      error: null,
      isConnected: true,
      projectCwd: config.projectCwd,
      reconnectCount: 0,
      socket,
      version: config.version,
    }),
}))
