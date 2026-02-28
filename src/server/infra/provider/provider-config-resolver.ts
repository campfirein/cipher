/**
 * Provider Config Resolver
 *
 * Resolves the full provider configuration (API key, base URL, headers, etc.)
 * for the currently active provider. Used by the daemon state server to serve
 * agent child processes on startup and after provider hot-swap.
 */

import {existsSync} from 'node:fs'
import {homedir} from 'node:os'
import {join} from 'node:path'

import type {IProviderConfigStore} from '../../core/interfaces/i-provider-config-store.js'
import type {IProviderKeychainStore} from '../../core/interfaces/i-provider-keychain-store.js'

import {getProviderById, providerRequiresApiKey} from '../../core/domain/entities/provider-registry.js'
import {type ProviderConfigResponse} from '../../core/domain/transport/schemas.js'
import {getProviderApiKeyFromEnv} from './env-provider-detector.js'
import {resolveVertexAiProject} from './vertex-ai-utils.js'

async function isProviderCredentialAccessible(
  providerId: string,
  providerKeychainStore: IProviderKeychainStore,
): Promise<boolean> {
  if (providerId === 'google-vertex') {
    const storedPath = await providerKeychainStore.getApiKey(providerId)
    if (storedPath) return existsSync(storedPath)
    return !getVertexAiCredentialError(process.env.GOOGLE_APPLICATION_CREDENTIALS)
  }

  if (!providerRequiresApiKey(providerId)) return true
  return Boolean((await providerKeychainStore.getApiKey(providerId)) || getProviderApiKeyFromEnv(providerId))
}

/**
 * Validate provider config integrity at startup.
 *
 * Iterates ALL connected providers and disconnects any whose credentials are no
 * longer accessible. This handles migration from v1 (system keychain) to v2
 * (file-based keystore) and other stale credential scenarios.
 *
 * If the previously active provider was stale, explicitly sets activeProvider to
 * empty string so the TUI routes to the provider setup flow — bypassing the
 * 'byterover' fallback that withProviderDisconnected() would otherwise apply.
 */
export async function clearStaleProviderConfig(
  providerConfigStore: IProviderConfigStore,
  providerKeychainStore: IProviderKeychainStore,
): Promise<void> {
  try {
    const config = await providerConfigStore.read()

    const results = await Promise.all(
      Object.keys(config.providers).map(async (providerId) => ({
        accessible: await isProviderCredentialAccessible(providerId, providerKeychainStore),
        providerId,
      })),
    )

    const staleProviderIds = results.filter(({accessible}) => !accessible).map(({providerId}) => providerId)

    if (staleProviderIds.length === 0) return

    // Build new config in ONE pass — avoids parallel-write race conditions
    // where multiple disconnectProvider() calls read the same cached config.
    let newConfig = config
    for (const providerId of staleProviderIds) {
      newConfig = newConfig.withProviderDisconnected(providerId)
    }

    // withProviderDisconnected() falls back to 'byterover' when the active provider is
    // removed, which causes the TUI to show 'ready' and skip provider setup. Explicitly
    // set activeProvider to '' so the user is returned to the provider setup flow.
    if (staleProviderIds.includes(config.activeProvider)) {
      newConfig = newConfig.withActiveProvider('')
    }

    await providerConfigStore.write(newConfig)
  } catch {
    // Non-critical: if validation fails, daemon continues normally.
    // The user will encounter a provider error when submitting a task instead.
  }
}

/**
 * Resolve the active provider's full configuration.
 *
 * Reads the active provider/model from the config store, resolves
 * the API key (keychain → env fallback), and maps provider-specific
 * fields (base URL, headers, location, etc.).
 */
export async function resolveProviderConfig(
  providerConfigStore: IProviderConfigStore,
  providerKeychainStore: IProviderKeychainStore,
): Promise<ProviderConfigResponse> {
  const config = await providerConfigStore.read()
  const {activeProvider} = config
  const activeModel = config.getActiveModel(activeProvider)

  if (!activeProvider || activeProvider === 'byterover') {
    return {activeModel, activeProvider}
  }

  if (activeProvider === 'google-vertex') {
    return resolveVertexAiConfig(activeModel, activeProvider, providerKeychainStore)
  }

  // Resolve API key: keychain first, then environment variable
  let apiKey = await providerKeychainStore.getApiKey(activeProvider)
  if (!apiKey) {
    apiKey = getProviderApiKeyFromEnv(activeProvider)
  }

  switch (activeProvider) {
    case 'openai-compatible': {
      return {
        activeModel,
        activeProvider,
        provider: activeProvider,
        providerApiKey: apiKey || undefined,
        providerBaseUrl: config.getBaseUrl(activeProvider) || undefined,
        providerKeyMissing: !apiKey,
      }
    }

    case 'openrouter': {
      return {
        activeModel,
        activeProvider,
        openRouterApiKey: apiKey || undefined,
        provider: activeProvider,
        providerKeyMissing: !apiKey,
      }
    }

    default: {
      const providerDef = getProviderById(activeProvider)
      const headers = providerDef?.headers
      return {
        activeModel,
        activeProvider,
        provider: activeProvider,
        providerApiKey: apiKey || undefined,
        providerBaseUrl: providerDef?.baseUrl || undefined,
        providerHeaders: headers && Object.keys(headers).length > 0 ? {...headers} : undefined,
        providerKeyMissing: !apiKey,
      }
    }
  }
}

/**
 * Resolve Google Vertex AI provider configuration.
 * Uses service account JSON from keychain or Application Default Credentials.
 */
async function resolveVertexAiConfig(
  activeModel: string | undefined,
  activeProvider: string,
  providerKeychainStore: IProviderKeychainStore,
): Promise<ProviderConfigResponse> {
  const storedCredentialPath = await providerKeychainStore.getApiKey(activeProvider)
  const effectiveCredentialPath = storedCredentialPath || process.env.GOOGLE_APPLICATION_CREDENTIALS || undefined
  const credentialError = getVertexAiCredentialError(effectiveCredentialPath)
  return {
    activeModel,
    activeProvider,
    provider: activeProvider,
    providerCredentialError: credentialError ?? undefined,
    providerCredentialPath: effectiveCredentialPath,
    providerKeyMissing: Boolean(credentialError),
    providerLocation: process.env.GOOGLE_CLOUD_LOCATION || 'us-central1',
    providerProject: resolveVertexAiProject(storedCredentialPath),
  }
}

/**
 * Lightweight check for Google Vertex AI credential availability.
 * Checks the given credential path and the well-known ADC file
 * without making network calls.
 *
 * @param credentialPath - Explicit credential file path (from keychain or env var).
 * @returns Error message if credentials are not found, null if accessible.
 */
function getVertexAiCredentialError(credentialPath: string | undefined): null | string {
  if (credentialPath) {
    if (!existsSync(credentialPath)) {
      return `Credential file not found: ${credentialPath}. Verify the path or run \`gcloud auth application-default login\`.`
    }

    return null
  }

  // Check well-known ADC location (created by `gcloud auth application-default login`)
  const adcPath = join(homedir(), '.config', 'gcloud', 'application_default_credentials.json')
  if (existsSync(adcPath)) {
    return null
  }

  return 'Google Cloud credentials not found. Run `gcloud auth application-default login` or set the GOOGLE_APPLICATION_CREDENTIALS environment variable.'
}
