import {type ConnectionResult, connectToDaemon} from '@campfirein/brv-transport-client'

import {resolveLocalServerMainPath} from '../../utils/server-main-resolver.js'

/**
 * Function type for transport connection (for DI/testing in use cases).
 *
 * Callers must pass an explicit resolved projectPath. This avoids silently
 * falling back to the transport library's own walk-up discovery, which is
 * not workspace-link-aware.
 */
export type TransportConnector = (fromDir: string | undefined, projectPath: string) => Promise<ConnectionResult>

/**
 * Creates a transport connector that auto-starts the daemon if needed.
 *
 * Thin wrapper around connectToDaemon() for DI compatibility with use cases
 * (QueryUseCase, CurateUseCase, StatusUseCase).
 *
 * When an explicit projectPath is provided it takes priority over the
 * transport library's walk-up discovery, making the connector workspace-link-aware.
 */
export function createDaemonAwareConnector(): TransportConnector {
  return (fromDir: string | undefined, projectPath: string) =>
    connectToDaemon({
      clientType: 'cli',
      fromDir,
      projectPath,
      serverPath: resolveLocalServerMainPath(),
    })
}
