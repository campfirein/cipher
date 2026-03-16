/**
 * Transport Store
 *
 * Zustand store for Socket.IO connection state and BrvApiClient instance.
 * Mirror of src/tui/stores/transport-store.ts adapted for browser Socket.
 */

import type {Socket} from 'socket.io-client'

import {create} from 'zustand'

import {BrvApiClient} from '../lib/api-client'

type ConnectionState = 'connected' | 'connecting' | 'disconnected' | 'reconnecting'

interface TransportState {
  apiClient: BrvApiClient | null
  connectionState: ConnectionState
  error: Error | null
  isConnected: boolean
  socket: null | Socket
}

interface TransportActions {
  reset: () => void
  setConnectionState: (state: ConnectionState) => void
  setError: (error: Error | null) => void
  setSocket: (socket: Socket) => void
}

const initialState: TransportState = {
  apiClient: null,
  connectionState: 'disconnected',
  error: null,
  isConnected: false,
  socket: null,
}

export const useTransportStore = create<TransportActions & TransportState>()((set) => ({
  ...initialState,

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

  setSocket: (socket: Socket) =>
    set({
      apiClient: new BrvApiClient(socket),
      connectionState: 'connected',
      error: null,
      isConnected: true,
      socket,
    }),
}))
