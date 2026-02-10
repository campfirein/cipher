/**
 * Provider Module Registry
 *
 * Central registry mapping provider IDs to their ProviderModule implementations.
 * Following opencode's pattern: the service layer calls getProviderModule(id) and
 * uses its createGenerator() factory without knowing provider internals.
 */

import type {IContentGenerator} from '../../../core/interfaces/i-content-generator.js'
import type {GeneratorFactoryConfig, ProviderModule} from './types.js'

import {anthropicProvider} from './anthropic.js'
import {byteroverProvider} from './byterover.js'
import {googleVertexProvider} from './google-vertex.js'
import {googleProvider} from './google.js'
import {groqProvider} from './groq.js'
import {mistralProvider} from './mistral.js'
import {openaiProvider} from './openai.js'
import {openrouterProvider} from './openrouter.js'
import {xaiProvider} from './xai.js'

/**
 * Registry of all available provider modules.
 * Sorted alphabetically by key for linting compliance.
 */
const PROVIDER_MODULES: Readonly<Record<string, ProviderModule>> = {
  anthropic: anthropicProvider,
  byterover: byteroverProvider,
  google: googleProvider,
  'google-vertex': googleVertexProvider,
  groq: groqProvider,
  mistral: mistralProvider,
  openai: openaiProvider,
  openrouter: openrouterProvider,
  xai: xaiProvider,
}

/**
 * Get a provider module by ID.
 */
export function getProviderModule(id: string): ProviderModule | undefined {
  return PROVIDER_MODULES[id]
}

/**
 * List all provider modules sorted by priority.
 */
export function listProviderModules(): ProviderModule[] {
  return Object.values(PROVIDER_MODULES).sort((a, b) => a.priority - b.priority)
}

/**
 * Create an IContentGenerator for a provider using the registry.
 *
 * @throws Error if the provider ID is not found in the registry.
 */
export function createGeneratorForProvider(
  id: string,
  config: GeneratorFactoryConfig,
): IContentGenerator {
  const providerModule = PROVIDER_MODULES[id]
  if (!providerModule) {
    throw new Error(`Unknown provider: ${id}`)
  }

  return providerModule.createGenerator(config)
}

// Re-export types
export type {GeneratorFactoryConfig, ProviderAuthType, ProviderModule, ProviderType} from './types.js'
