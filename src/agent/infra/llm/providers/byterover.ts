/**
 * ByteRover Internal Provider Module
 *
 * Internal LLM provider using the ByteRover HTTP backend.
 * Uses ByteRoverLlmHttpService for API calls.
 * Will be removed in a future version.
 */

import type {GeneratorFactoryConfig, ProviderModule} from './types.js'

import {ByteRoverLlmHttpService} from '../../http/internal-llm-http-service.js'
import {ByteRoverContentGenerator} from '../generators/byterover-content-generator.js'

export const byteroverProvider: ProviderModule = {
  authType: 'internal',
  category: 'popular',
  createGenerator(config: GeneratorFactoryConfig) {
    const httpConfig = config.httpConfig as {
      apiBaseUrl: string
      projectId: string
      region?: string
      sessionKey: string
      spaceId: string
      teamId: string
      timeout?: number
    }

    const httpService = new ByteRoverLlmHttpService({
      apiBaseUrl: httpConfig.apiBaseUrl,
      projectId: httpConfig.projectId,
      region: httpConfig.region,
      sessionKey: httpConfig.sessionKey,
      spaceId: httpConfig.spaceId,
      teamId: httpConfig.teamId,
      timeout: httpConfig.timeout,
    })

    return new ByteRoverContentGenerator(httpService, {
      maxTokens: config.maxTokens,
      model: config.model,
      temperature: config.temperature,
    })
  },
  defaultModel: 'gemini-3.1-flash-lite-preview',
  description: 'Internal ByteRover LLM',
  envVars: [],
  id: 'byterover',
  name: 'ByteRover',
  priority: 0,

  providerType: 'gemini',
}
