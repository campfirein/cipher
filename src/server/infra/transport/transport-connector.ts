import {type ConnectionResult, connectToTransport, DaemonInstanceDiscovery} from '@campfirein/brv-transport-client'

import {ensureDaemonRunning} from '../daemon/daemon-spawner.js'

/** Function type for transport connection (for DI/testing in use cases). */
export type TransportConnector = (fromDir?: string) => Promise<ConnectionResult>

/**
 * Creates a transport connector that auto-starts the daemon if needed.
 *
 * Flow: ensureDaemonRunning() → connectToTransport() → auto-register with projectPath
 *
 * This ensures any CLI command (query, curate, status, debug) works
 * without requiring the user to manually start `brv` first.
 *
 * Auto-registers CLI clients with projectPath = fromDir (or cwd if not specified).
 */
export function createDaemonAwareConnector(): TransportConnector {
  return async (fromDir?: string) => {
    await ensureDaemonRunning()

    // Connect without auto-registration (we'll register manually with projectPath)
    const result = await connectToTransport(fromDir, {
      autoRegister: false,
      discovery: new DaemonInstanceDiscovery(),
    })

    // Manually register with projectPath = fromDir (or cwd)
    const projectPath = fromDir ?? process.cwd()
    await result.client.requestWithAck('client:register', {
      clientType: 'cli',
      projectPath,
    })

    return result
  }
}
