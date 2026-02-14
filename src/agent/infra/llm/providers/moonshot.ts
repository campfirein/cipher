/**
 * Moonshot AI (Kimi) Provider Module
 *
 * Access to Kimi models via their OpenAI-compatible API.
 */

import {createOpenAICompatible} from '@ai-sdk/openai-compatible'

import type {GeneratorFactoryConfig, ProviderModule} from './types.js'

import {AiSdkContentGenerator} from '../generators/ai-sdk-content-generator.js'

export const moonshotProvider: ProviderModule = {
  apiKeyUrl: 'https://platform.moonshot.ai/console/api-keys',
  authType: 'api-key',
  baseUrl: 'https://api.moonshot.ai/v1',
  category: 'other',
  createGenerator(config: GeneratorFactoryConfig) {
    const provider = createOpenAICompatible({
      apiKey: config.apiKey!,
      baseURL: 'https://api.moonshot.ai/v1',
      name: 'moonshot',
    })

    return new AiSdkContentGenerator({
      model: provider.chatModel(config.model),
    })
  },
  defaultModel: 'kimi-k2.5',
  description: 'Kimi models by Moonshot AI',
  envVars: ['MOONSHOT_API_KEY'],
  id: 'moonshot',
  name: 'Moonshot AI (Kimi)',
  priority: 18,

  providerType: 'openai',
}
