/**
 * Transport Store
 *
 * Global Zustand store for transport connection state and the BrvApiClient instance.
 * This is the foundational store — all feature stores depend on the apiClient from here.
 * Also holds app-level metadata like version.
 */

import type {ConnectionState, ITransportClient} from '@campfirein/brv-transport-client'

import {create} from 'zustand'

import {BrvApiClient} from '../lib/api-client.js'

export interface TransportState {
  /** The BrvApiClient instance (typed wrapper around transport client) */
  apiClient: BrvApiClient | null
  /** The raw transport client */
  client: ITransportClient | null
  /** Current connection state */
  connectionState: ConnectionState
  /**
   * Daemon version reported in the most recent client:register ack.
   * Undefined when the daemon is too old to advertise its version.
   * Drives the version-drift indicator in the TUI header.
   */
  daemonVersion: string | undefined
  /** Connection error if any */
  error: Error | null
  /** Whether the client is connected */
  isConnected: boolean
  /** Resolved project path (where .brv/ lives) */
  projectPath: null | string
  /** Number of reconnection attempts */
  reconnectCount: number
  /** App version */
  version: string
  /** Resolved workspace root (linked subdir or projectRoot if unlinked) */
  worktreeRoot: null | string
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
  /** Set or clear the daemon version (called after every connect / reconnect) */
  setDaemonVersion: (daemonVersion: string | undefined) => void
  /** Set connection error */
  setError: (error: Error | null) => void
  /** Set resolved project info from oclif main */
  setProjectInfo: (projectPath?: string, worktreeRoot?: string) => void
  /** Set app version */
  setVersion: (version: string) => void
}

const initialState: TransportState = {
  apiClient: null,
  client: null,
  connectionState: 'disconnected',
  daemonVersion: undefined,
  error: null,
  isConnected: false,
  projectPath: null,
  reconnectCount: 0,
  version: '',
  worktreeRoot: null,
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

  setDaemonVersion: (daemonVersion: string | undefined) => set({daemonVersion}),

  setError: (error: Error | null) =>
    set({
      connectionState: 'disconnected',
      error,
      isConnected: false,
    }),

  setProjectInfo: (projectPath?: string, worktreeRoot?: string) =>
    set({
      projectPath: projectPath ?? null,
      worktreeRoot: worktreeRoot ?? null,
    }),

  setVersion: (version: string) => set({version}),
}))
