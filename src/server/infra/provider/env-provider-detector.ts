/**
 * Environment Variable Provider Detector
 *
 * Detects LLM providers from environment variables.
 * Used to auto-connect providers when API keys are found in the environment.
 */

import {PROVIDER_REGISTRY} from '../../core/domain/entities/provider-registry.js'

/**
 * A detected provider from the environment.
 */
export interface DetectedProvider {
  /** The API key value from the environment */
  apiKey: string
  /** The environment variable name that was found */
  envVar: string
  /** The provider ID (e.g., 'anthropic', 'openai') */
  providerId: string
}

/**
 * Detect providers from environment variables.
 *
 * Scans all providers in the registry for their `envVars` configuration
 * and checks if any of those environment variables are set.
 *
 * @returns Array of detected providers with their API keys
 */
export function detectProvidersFromEnv(): DetectedProvider[] {
  const detected: DetectedProvider[] = []

  for (const provider of Object.values(PROVIDER_REGISTRY)) {
    if (!provider.envVars || provider.envVars.length === 0) continue

    for (const envVar of provider.envVars) {
      const value = process.env[envVar]
      if (value && value.trim().length > 0) {
        detected.push({
          apiKey: value.trim(),
          envVar,
          providerId: provider.id,
        })
        break // Only take the first matching env var per provider
      }
    }
  }

  return detected
}

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
