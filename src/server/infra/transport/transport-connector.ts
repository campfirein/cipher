import {type ConnectionResult, connectToTransport, DaemonInstanceDiscovery} from '@campfirein/brv-transport-client'

import {ensureDaemonRunning} from '../daemon/daemon-spawner.js'

/** Function type for transport connection (for DI/testing in use cases). */
export type TransportConnector = (fromDir?: string) => Promise<ConnectionResult>

/**
 * Creates a transport connector that auto-starts the daemon if needed.
 *
 * Flow: ensureDaemonRunning() → connectToTransport()
 *
 * This ensures any CLI command (query, curate, status, debug) works
 * without requiring the user to manually start `brv` first.
 */
export function createDaemonAwareConnector(): TransportConnector {
  return async (fromDir?: string) => {
    await ensureDaemonRunning()
    return connectToTransport(fromDir, {discovery: new DaemonInstanceDiscovery()})
  }
}
