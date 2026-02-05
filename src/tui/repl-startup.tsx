import type {ITransportClient} from '@campfirein/brv-transport-client'

import {render} from 'ink'

import type {ITokenStore} from '../server/core/interfaces/auth/i-token-store.js'
import type {IConnectorManager} from '../server/core/interfaces/connectors/i-connector-manager.js'
import type {ITrackingService} from '../server/core/interfaces/services/i-tracking-service.js'
import type {IOnboardingPreferenceStore} from '../server/core/interfaces/storage/i-onboarding-preference-store.js'
import type {IProjectConfigStore} from '../server/core/interfaces/storage/i-project-config-store.js'

import {App} from './app.js'
import {AppProviders} from './providers/app-providers.js'
import {connectTransportClient, disconnectTransportClient} from './utils/transport-client-helper.js'

/** Broadcast client - joins broadcast-room to monitor all events */
let transportBroadcastClient: ITransportClient | null = null

/**
 * Options for starting the REPL
 *
 * Architecture v0.5.0:
 * - TUI discovers Transport via TransportClientFactory (same as external CLIs)
 * - TUI is a Socket.IO client, Transport is the only server
 */
export interface ReplOptions {
  connectorManager: IConnectorManager
  onboardingPreferenceStore: IOnboardingPreferenceStore
  projectConfigStore: IProjectConfigStore
  tokenStore: ITokenStore
  trackingService: ITrackingService
  version: string
}

/**
 * Start the ByteRover REPL
 */
export async function startRepl(options: ReplOptions): Promise<void> {
  const {connectorManager, onboardingPreferenceStore, projectConfigStore, tokenStore, trackingService, version} =
    options

  // Connect broadcast client to monitor all events
  transportBroadcastClient = await connectTransportClient()

  // Check initial auth state
  const authToken = await tokenStore.load()
  const isAuthorized = authToken !== undefined && authToken.isValid()

  // Load project config if authorized
  let brvConfig
  if (isAuthorized) {
    const configExists = await projectConfigStore.exists()
    if (configExists) {
      brvConfig = await projectConfigStore.read()
    }
  }

  await trackingService.track('repl', {status: 'started'})

  const {waitUntilExit} = render(
    <AppProviders
      connectorManager={connectorManager}
      initialAuthToken={isAuthorized ? authToken : undefined}
      initialBrvConfig={brvConfig}
      onboardingPreferenceStore={onboardingPreferenceStore}
      projectConfigStore={projectConfigStore}
      tokenStore={tokenStore}
      trackingService={trackingService}
      version={version}
    >
      <App />
    </AppProviders>,
  )

  await waitUntilExit()

  // Cleanup
  await disconnectTransportClient(transportBroadcastClient)
  transportBroadcastClient = null
  await trackingService.track('repl', {status: 'finished'})
}
