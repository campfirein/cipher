/**
 * Together AI Provider Module
 *
 * Open-source model inference via @ai-sdk/togetherai.
 */

import {createTogetherAI} from '@ai-sdk/togetherai'

import type {GeneratorFactoryConfig, ProviderModule} from './types.js'

import {AiSdkContentGenerator} from '../generators/ai-sdk-content-generator.js'

export const togetheraiProvider: ProviderModule = {
  apiKeyUrl: 'https://api.together.ai/settings/api-keys',
  authType: 'api-key',
  baseUrl: 'https://api.together.xyz/v1',
  category: 'other',
  createGenerator(config: GeneratorFactoryConfig) {
    const provider = createTogetherAI({apiKey: config.apiKey!})

    return new AiSdkContentGenerator({
      model: provider(config.model),
    })
  },
  defaultModel: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
  description: 'Open-source model inference',
  envVars: ['TOGETHER_API_KEY', 'TOGETHERAI_API_KEY'],
  id: 'togetherai',
  name: 'Together AI',
  priority: 12,

  providerType: 'openai',
}
