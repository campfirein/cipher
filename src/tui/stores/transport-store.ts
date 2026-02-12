/**
 * Transport Store
 *
 * Global Zustand store for transport connection state and the BrvApiClient instance.
 * This is the foundational store — all feature stores depend on the apiClient from here.
 * Also holds app-level services: trackingService and version.
 */

import type {ConnectionState, ITransportClient} from '@campfirein/brv-transport-client'

import {create} from 'zustand'

import {BrvApiClient} from '../lib/api-client.js'

/**
 * Tracking service interface
 */
export interface TrackingService {
  track(event: string, properties?: Record<string, unknown>): Promise<void>
}

export interface TransportState {
  /** The BrvApiClient instance (typed wrapper around transport client) */
  apiClient: BrvApiClient | null
  /** The raw transport client */
  client: ITransportClient | null
  /** Current connection state */
  connectionState: ConnectionState
  /** Connection error if any */
  error: Error | null
  /** Whether the client is connected */
  isConnected: boolean
  /** Number of reconnection attempts */
  reconnectCount: number
  /** Tracking service for analytics */
  trackingService: null | TrackingService
  /** App version */
  version: string
}

export interface TransportActions {
  /** Increment reconnect count */
  incrementReconnectCount: () => void
  /** Reset store on disconnect */
  reset: () => void
  /** Set the connected client and create apiClient */
  setClient: (client: ITransportClient) => void
  /** Update connection state */
  setConnectionState: (state: ConnectionState) => void
  /** Set connection error */
  setError: (error: Error | null) => void
  /** Set tracking service */
  setTrackingService: (trackingService: TrackingService) => void
  /** Set app version */
  setVersion: (version: string) => void
}

const initialState: TransportState = {
  apiClient: null,
  client: null,
  connectionState: 'disconnected',
  error: null,
  isConnected: false,
  reconnectCount: 0,
  trackingService: null,
  version: '',
}

export const useTransportStore = create<TransportActions & TransportState>()((set) => ({
  ...initialState,

  incrementReconnectCount: () => set((state) => ({reconnectCount: state.reconnectCount + 1})),

  reset: () => set(initialState),

  setClient: (client: ITransportClient) =>
    set({
      apiClient: new BrvApiClient(client),
      client,
      connectionState: client.getState(),
      error: null,
      isConnected: client.getState() === 'connected',
    }),

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

  setTrackingService: (trackingService: TrackingService) => set({trackingService}),

  setVersion: (version: string) => set({version}),
}))
