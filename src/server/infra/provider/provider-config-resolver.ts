/**
 * Provider Config Resolver
 *
 * Resolves the full provider configuration (API key, base URL, headers, etc.)
 * for the currently active provider. Used by the daemon state server to serve
 * agent child processes on startup and after provider hot-swap.
 */

import type {IProviderConfigStore} from '../../core/interfaces/i-provider-config-store.js'
import type {IProviderKeychainStore} from '../../core/interfaces/i-provider-keychain-store.js'

import {getProviderById} from '../../core/domain/entities/provider-registry.js'
import {type ProviderConfigResponse} from '../../core/domain/transport/schemas.js'
import {getProviderApiKeyFromEnv} from './env-provider-detector.js'

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

  // Empty activeProvider (unconfigured) falls back to ByteRover internal API
  if (!activeProvider || activeProvider === 'byterover') {
    return {activeModel, activeProvider: activeProvider || 'byterover'}
  }

  // google-vertex uses Application Default Credentials, not an API key
  if (activeProvider === 'google-vertex') {
    return {
      activeModel,
      activeProvider,
      provider: activeProvider,
      providerLocation: process.env.GOOGLE_CLOUD_LOCATION || 'us-central1',
      providerProject: process.env.GOOGLE_CLOUD_PROJECT || undefined,
    }
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
      }
    }

    case 'openrouter': {
      return {activeModel, activeProvider, openRouterApiKey: apiKey || undefined, provider: activeProvider}
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
      }
    }
  }
}
