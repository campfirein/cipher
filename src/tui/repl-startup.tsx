import {render} from 'ink'

import {App} from './app/index.js'
import {AppProviders} from './providers/app-providers.js'
import {type TrackingService, useTransportStore} from './stores/transport-store.js'

export type {TrackingService} from './stores/transport-store.js'

/**
 * Options for starting the REPL
 *
 * - TUI is a Socket.IO client, Transport is the only server
 */
export interface ReplOptions {
  trackingService: TrackingService
  version: string
}

/**
 * Start the ByteRover REPL
 */
export async function startRepl(options: ReplOptions): Promise<void> {
  const {trackingService, version} = options

  // Set tracking service and version in store before rendering
  useTransportStore.getState().setTrackingService(trackingService)
  useTransportStore.getState().setVersion(version)

  await trackingService.track('repl', {status: 'started'})

  const {waitUntilExit} = render(
    <AppProviders>
      <App />
    </AppProviders>,
  )

  await waitUntilExit()
  await trackingService.track('repl', {status: 'finished'})
}
