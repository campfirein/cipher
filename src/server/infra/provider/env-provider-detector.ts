/**
 * Environment Variable Provider Detector
 *
 * Detects LLM providers from environment variables.
 * Used to auto-connect providers when API keys are found in the environment.
 */

import {PROVIDER_REGISTRY} from '../../core/domain/entities/provider-registry.js'

/**
 * Check if a specific provider has an API key set via environment variable.
 *
 * @param providerId - The provider ID to check
 * @returns The API key if found, undefined otherwise
 */
export function getProviderApiKeyFromEnv(providerId: string): string | undefined {
  const provider = PROVIDER_REGISTRY[providerId]
  if (!provider?.envVars) return undefined

  for (const envVar of provider.envVars) {
    const value = process.env[envVar]
    if (value && value.trim().length > 0) {
      return value.trim()
    }
  }

  return undefined
}
