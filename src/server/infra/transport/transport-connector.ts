import {type ConnectionResult, connectToDaemon} from '@campfirein/brv-transport-client'

import {resolveLocalServerMainPath} from '../../utils/server-main-resolver.js'

/** Function type for transport connection (for DI/testing in use cases). */
export type TransportConnector = (fromDir?: string) => Promise<ConnectionResult>

/**
 * Creates a transport connector that auto-starts the daemon if needed.
 *
 * Thin wrapper around connectToDaemon() for DI compatibility with use cases
 * (QueryUseCase, CurateUseCase, StatusUseCase).
 *
 * projectPath is auto-filled by the transport library from the discovered
 * project root (walks up from fromDir to find .brv/).
 */
export function createDaemonAwareConnector(projectPath?: string): TransportConnector {
  return (fromDir?: string) =>
    connectToDaemon({
      clientType: 'cli',
      fromDir,
      projectPath,
      serverPath: resolveLocalServerMainPath(),
    })
}
