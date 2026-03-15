/**
 * OpenAI Provider Module
 *
 * Direct access to GPT models via @ai-sdk/openai.
 */

import {createOpenAI} from '@ai-sdk/openai'

import type {GeneratorFactoryConfig, ProviderModule} from './types.js'

import {AiSdkContentGenerator} from '../generators/ai-sdk-content-generator.js'

export const openaiProvider: ProviderModule = {
  apiKeyUrl: 'https://platform.openai.com/api-keys',
  authType: 'api-key',
  baseUrl: 'https://api.openai.com/v1',
  category: 'popular',
  createGenerator(config: GeneratorFactoryConfig) {
    const provider = createOpenAI({
      apiKey: config.apiKey ?? '',
      baseURL: config.baseUrl,
      headers: config.headers,
    })

    return new AiSdkContentGenerator({
      model: provider.responses(config.model),
    })
  },
  defaultModel: 'gpt-4.1',
  description: 'GPT models by OpenAI',
  envVars: ['OPENAI_API_KEY'],
  id: 'openai',
  name: 'OpenAI',
  priority: 3,

  providerType: 'openai',
}
