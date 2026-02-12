/**
 * GLM (Zhipu AI / Z.AI) Provider Module
 *
 * Access to GLM models via their OpenAI-compatible API.
 */

import {createOpenAICompatible} from '@ai-sdk/openai-compatible'

import type {GeneratorFactoryConfig, ProviderModule} from './types.js'

import {AiSdkContentGenerator} from '../generators/ai-sdk-content-generator.js'

export const glmProvider: ProviderModule = {
  apiKeyUrl: 'https://open.z.ai',
  authType: 'api-key',
  baseUrl: 'https://api.z.ai/api/paas/v4',
  category: 'other',
  createGenerator(config: GeneratorFactoryConfig) {
    const provider = createOpenAICompatible({
      apiKey: config.apiKey!,
      baseURL: 'https://api.z.ai/api/paas/v4',
      name: 'glm',
    })

    return new AiSdkContentGenerator({
      model: provider.chatModel(config.model),
    })
  },
  defaultModel: 'glm-4.7',
  description: 'GLM models by Zhipu AI',
  envVars: ['ZHIPU_API_KEY'],
  id: 'glm',
  name: 'GLM (Z.AI)',
  priority: 17,

  providerType: 'openai',
}
