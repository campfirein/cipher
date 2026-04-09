import {render} from 'ink'

import {App} from './app/index.js'
import {AppProviders} from './providers/app-providers.js'
import {useTransportStore} from './stores/transport-store.js'

/**
 * Options for starting the REPL
 *
 * - TUI is a Socket.IO client, Transport is the only server
 * - TransportInitializer connects to daemon via connectToDaemon()
 */
export interface ReplOptions {
  projectPath?: string
  version: string
  worktreeRoot?: string
}

/**
 * Start the ByteRover REPL
 */
export async function startRepl(options: ReplOptions): Promise<void> {
  const {projectPath, version, worktreeRoot} = options

  // Set version and project info in store before rendering
  const store = useTransportStore.getState()
  store.setVersion(version)
  store.setProjectInfo(projectPath, worktreeRoot)

  const {waitUntilExit} = render(
    <AppProviders>
      <App />
    </AppProviders>,
  )

  await waitUntilExit()
}
