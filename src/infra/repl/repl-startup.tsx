import {render} from 'ink'

import type {IProjectConfigStore} from '../../core/interfaces/i-project-config-store.js'
import type {ITokenStore} from '../../core/interfaces/i-token-store.js'

import {App} from '../../tui/app.js'
import {AppProviders} from '../../tui/providers/app-providers.js'
import {stopQueuePollingService} from '../cipher/consumer/queue-polling-service.js'

/**
 * Options for starting the REPL
 */
export interface ReplOptions {
  projectConfigStore: IProjectConfigStore
  tokenStore: ITokenStore
  version: string
}

/**
 * Start the ByteRover REPL
 */
export async function startRepl(options: ReplOptions): Promise<void> {
  const {projectConfigStore, tokenStore, version} = options

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

  // Render the App with providers
  const {waitUntilExit} = render(
    <AppProviders
      initialAuthToken={isAuthorized ? authToken : undefined}
      initialBrvConfig={brvConfig}
      projectConfigStore={projectConfigStore}
      tokenStore={tokenStore}
      version={version}
    >
      <App />
    </AppProviders>,
  )

  await waitUntilExit()
  stopQueuePollingService()
}
