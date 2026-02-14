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
  version: string
}

/**
 * Start the ByteRover REPL
 */
export async function startRepl(options: ReplOptions): Promise<void> {
  const {version} = options

  // Set version in store before rendering
  useTransportStore.getState().setVersion(version)

  const {waitUntilExit} = render(
    <AppProviders>
      <App />
    </AppProviders>,
  )

  await waitUntilExit()
}
