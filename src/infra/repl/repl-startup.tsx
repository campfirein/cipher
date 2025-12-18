import {render} from 'ink'

import type {IOnboardingPreferenceStore} from '../../core/interfaces/i-onboarding-preference-store.js'
import type {IProjectConfigStore} from '../../core/interfaces/i-project-config-store.js'
import type {ITokenStore} from '../../core/interfaces/i-token-store.js'
import type {ITrackingService} from '../../core/interfaces/i-tracking-service.js'

import {App} from '../../tui/app.js'
import {AppProviders} from '../../tui/providers/app-providers.js'
import {stopQueuePollingService} from '../cipher/consumer/queue-polling-service.js'

/**
 * Options for starting the REPL
 *
 * Architecture v0.5.0:
 * - transportPort: Port for TUI to connect to Transport via Socket.IO
 * - TUI is a Socket.IO client, Transport is the only server
 */
export interface ReplOptions {
  onboardingPreferenceStore: IOnboardingPreferenceStore
  projectConfigStore: IProjectConfigStore
  tokenStore: ITokenStore
  trackingService: ITrackingService
  /** Port for TUI to connect to Transport (v0.5.0 architecture) */
  transportPort?: number
  version: string
}

/**
 * Start the ByteRover REPL
 */
export async function startRepl(options: ReplOptions): Promise<void> {
  const {onboardingPreferenceStore, projectConfigStore, tokenStore, trackingService, transportPort, version} = options

  // Log transport port for debugging (v0.5.0 architecture)
  if (transportPort) {
    console.log(`[REPL] Transport available on port ${transportPort}`)
  }

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
  // Render the App with providers
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
  stopQueuePollingService()
  await trackingService.track('repl', {status: 'finished'})
}
