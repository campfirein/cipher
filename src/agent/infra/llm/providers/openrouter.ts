/**
 * OpenRouter Provider Module
 *
 * Access 200+ models via the OpenRouter aggregator using @openrouter/ai-sdk-provider.
 */

import {createOpenRouter} from '@openrouter/ai-sdk-provider'

import type {GeneratorFactoryConfig, ProviderModule} from './types.js'

import {modelAcceptsSamplingParameters} from '../../../core/domain/llm/registry.js'
import {AiSdkContentGenerator} from '../generators/ai-sdk-content-generator.js'

export const openrouterProvider: ProviderModule = {
  apiKeyUrl: 'https://openrouter.ai/keys',
  authType: 'api-key',
  baseUrl: 'https://openrouter.ai/api/v1',
  category: 'popular',
  createGenerator(config: GeneratorFactoryConfig) {
    const provider = createOpenRouter({apiKey: config.apiKey!})

    return new AiSdkContentGenerator({
      excludeSamplingParameters: !modelAcceptsSamplingParameters(config.model),
      model: provider.chat(config.model),
    })
  },
  defaultModel: 'anthropic/claude-sonnet-4.5',
  description: 'Access 200+ models via aggregator',
  envVars: ['OPENROUTER_API_KEY'],
  id: 'openrouter',
  name: 'OpenRouter',
  priority: 1,

  providerType: 'openai',
}
