import {createOpenAICompatible} from '@ai-sdk/openai-compatible'

import type {GeneratorFactoryConfig, ProviderModule} from './types.js'

import {COPILOT_API_BASE_URL, COPILOT_REQUEST_HEADERS} from '../../../../shared/constants/copilot.js'
import {AiSdkContentGenerator} from '../generators/ai-sdk-content-generator.js'

export function isCopilotClaudeModel(model: string): boolean {
  return model.startsWith('claude-')
}

export const githubCopilotProvider: ProviderModule = {
  authType: 'api-key',
  category: 'popular',
  createGenerator(config: GeneratorFactoryConfig) {
    const baseUrl = config.baseUrl || COPILOT_API_BASE_URL
    const apiKey = config.apiKey || ''
    const headers = {
      ...config.headers,
      ...COPILOT_REQUEST_HEADERS,
    }

    const provider = createOpenAICompatible({
      apiKey,
      baseURL: baseUrl,
      headers,
      name: 'github-copilot',
    })

    return new AiSdkContentGenerator({
      charsPerToken: isCopilotClaudeModel(config.model) ? 3.5 : undefined,
      model: provider.chatModel(config.model),
    })
  },
  defaultModel: 'claude-sonnet-4.6',
  description: 'All models via GitHub Copilot subscription',
  envVars: [],
  id: 'github-copilot',
  name: 'GitHub Copilot',
  priority: 8,
  providerType: 'openai',
}
