import {render} from 'ink'

import type {IOnboardingPreferenceStore} from '../../core/interfaces/i-onboarding-preference-store.js'
import type {IProjectConfigStore} from '../../core/interfaces/i-project-config-store.js'
import type {ITokenStore} from '../../core/interfaces/i-token-store.js'
import type {ITrackingService} from '../../core/interfaces/i-tracking-service.js'
import type {ITransportClient} from '../../core/interfaces/transport/i-transport-client.js'

import {App} from '../../tui/app.js'
import {AppProviders} from '../../tui/providers/app-providers.js'
import {stopQueuePollingService} from '../cipher/consumer/queue-polling-service.js'
import {connectTransportClient, disconnectTransportClient} from './transport-client-helper.js'

/** Global transport client - lives for entire REPL session */
let transportClient: ITransportClient | null = null

/**
 * Options for starting the REPL
 *
 * Architecture v0.5.0:
 * - TUI discovers Transport via TransportClientFactory (same as external CLIs)
 * - TUI is a Socket.IO client, Transport is the only server
 */
export interface ReplOptions {
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
  const {onboardingPreferenceStore, projectConfigStore, tokenStore, trackingService, version} = options

  // Connect to Transport (discovers via instance.json)
  transportClient = await connectTransportClient()

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
  await disconnectTransportClient(transportClient)
  transportClient = null
  stopQueuePollingService()
  await trackingService.track('repl', {status: 'finished'})
}
