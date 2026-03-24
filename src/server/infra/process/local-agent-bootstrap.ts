/**
 * Local agent bootstrap — creates a CipherAgent without daemon transport.
 *
 * Used by standalone CLI commands (e.g. `brv reorg`) that need an agent
 * but don't go through the daemon process lifecycle.
 *
 * Mirrors the agent-process.ts bootstrap flow (steps 1–5) but replaces
 * transport-based config resolution with direct file reads.
 */

import {randomUUID} from 'node:crypto'

import type {CipherAgent} from '../../../agent/infra/agent/cipher-agent.js'

import {getCurrentConfig} from '../../config/environment.js'
import {DEFAULT_LLM_MODEL, PROJECT} from '../../constants.js'
import {BrvConfig} from '../../core/domain/entities/brv-config.js'
import {ProjectConfigStore} from '../config/file-config-store.js'
import {ProjectRegistry} from '../project/project-registry.js'
import {createProviderOAuthTokenStore} from '../provider-oauth/provider-oauth-token-store.js'
import {TokenRefreshManager} from '../provider-oauth/token-refresh-manager.js'
import {resolveProviderConfig} from '../provider/provider-config-resolver.js'
import {AuthStateStore} from '../state/auth-state-store.js'
import {FileProviderConfigStore} from '../storage/file-provider-config-store.js'
import {FileProviderKeychainStore} from '../storage/file-provider-keychain-store.js'
import {FileTokenStore} from '../storage/file-token-store.js'

export interface LocalAgentResult {
  agent: CipherAgent
  cleanup: () => Promise<void>
  storagePath: string
}

/**
 * Create a local CipherAgent without daemon transport.
 *
 * Steps:
 * 1. Load auth token
 * 2. Register project (idempotent)
 * 3. Resolve provider config (API key, model, etc.)
 * 4. Build AgentConfig matching agent-process.ts pattern
 * 5. Create CipherAgent, start, create session
 *
 * @param projectPath - Absolute path to the project directory
 * @returns Agent instance, cleanup function, and storage path
 */
export async function createLocalAgent(projectPath: string): Promise<LocalAgentResult> {
  // 1. Load auth token
  const tokenStore = new FileTokenStore()
  const authStateStore = new AuthStateStore({tokenStore})
  const authToken = await authStateStore.loadToken()
  const sessionKey = authToken?.sessionKey ?? ''

  // 2. Register project (idempotent) → get storagePath
  const projectRegistry = new ProjectRegistry()
  const projectInfo = projectRegistry.register(projectPath)
  const {storagePath} = projectInfo

  // 3. Load BrvConfig from project (optional — may not exist for local-only usage)
  const projectConfigStore = new ProjectConfigStore()
  let brvConfig: BrvConfig | undefined
  try {
    brvConfig = await projectConfigStore.read(projectPath)
  } catch {
    // No .brv/config.json — use local-only config
  }

  if (!brvConfig) {
    brvConfig = BrvConfig.createLocal({cwd: projectPath})
  }

  // 4. Resolve provider config
  const providerConfigStore = new FileProviderConfigStore()
  const providerKeychainStore = new FileProviderKeychainStore()
  const providerOAuthTokenStore = createProviderOAuthTokenStore()
  const tokenRefreshManager = new TokenRefreshManager({
    providerConfigStore,
    providerKeychainStore,
    providerOAuthTokenStore,
    transport: undefined,
  })

  const providerResult = await resolveProviderConfig(
    providerConfigStore,
    providerKeychainStore,
    tokenRefreshManager,
  )

  const {activeModel, activeProvider} = providerResult
  if (!activeProvider) {
    throw new Error('No active provider configured. Run `brv providers` to set up a provider.')
  }

  if (providerResult.providerKeyMissing) {
    throw new Error(
      `API key missing for provider "${activeProvider}". Run \`brv providers\` to configure credentials.`,
    )
  }

  // 5. Build agentConfig (matches agent-process.ts pattern)
  const envConfig = getCurrentConfig()
  const agentConfig = {
    apiBaseUrl: envConfig.llmApiBaseUrl,
    fileSystem: {workingDirectory: projectPath},
    llm: {
      maxIterations: 50,
      maxTokens: 4096,
      temperature: 0.7,
      topK: 10,
      topP: 0.95,
      verbose: false,
    },
    maxInputTokens: providerResult.maxInputTokens,
    model: activeModel ?? DEFAULT_LLM_MODEL,
    openRouterApiKey: providerResult.openRouterApiKey,
    projectId: PROJECT,
    provider: providerResult.provider,
    providerApiKey: providerResult.providerApiKey,
    providerBaseUrl: providerResult.providerBaseUrl,
    providerHeaders: providerResult.providerHeaders,
    sessionKey,
    storagePath,
  }

  // 6. Create CipherAgent (dynamic import to avoid circular deps at module level)
  const {CipherAgent: CipherAgentClass} = await import('../../../agent/infra/agent/cipher-agent.js')

  const agent = new CipherAgentClass(agentConfig, brvConfig, {
    projectIdProvider: () => PROJECT,
    sessionKeyProvider: () => sessionKey,
    spaceIdProvider: () => brvConfig?.spaceId ?? '',
    teamIdProvider: () => brvConfig?.teamId ?? '',
  })

  // 7. Start agent and create session
  await agent.start()

  const sessionId = `local-session-${randomUUID()}`
  await agent.createSession(sessionId)
  agent.switchDefaultSession(sessionId)

  // 8. Build cleanup function
  const cleanup = async () => {
    try {
      await agent.stop()
    } catch {
      // Best-effort cleanup
    }
  }

  return {agent, cleanup, storagePath}
}
