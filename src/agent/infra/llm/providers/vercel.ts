/**
 * Vercel Provider Module
 *
 * Vercel AI-powered models via @ai-sdk/vercel.
 */

import {createVercel} from '@ai-sdk/vercel'

import type {GeneratorFactoryConfig, ProviderModule} from './types.js'

import {AiSdkContentGenerator} from '../generators/ai-sdk-content-generator.js'

export const vercelProvider: ProviderModule = {
  apiKeyUrl: 'https://v0.dev/chat/settings/keys',
  authType: 'api-key',
  baseUrl: 'https://api.v0.dev/v1',
  category: 'other',
  createGenerator(config: GeneratorFactoryConfig) {
    const provider = createVercel({
      apiKey: config.apiKey!,
      headers: {
        'http-referer': 'https://byterover.dev',
        'x-title': 'byterover-cli',
      },
    })

    return new AiSdkContentGenerator({
      model: provider(config.model),
    })
  },
  defaultModel: 'v0-1.0-md',
  description: 'Vercel AI-powered models',
  envVars: ['VERCEL_API_KEY'],
  id: 'vercel',
  name: 'Vercel',
  priority: 15,

  providerType: 'openai',
}
