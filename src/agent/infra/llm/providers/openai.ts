/**
 * OpenAI Provider Module
 *
 * Direct access to GPT models via @ai-sdk/openai.
 * Supports both standard OpenAI API and ChatGPT OAuth (Codex) endpoint.
 */

import {createOpenAI} from '@ai-sdk/openai'

import type {GeneratorFactoryConfig, ProviderModule} from './types.js'

import {CHATGPT_OAUTH_BASE_URL} from '../../../../shared/constants/oauth.js'
import {AiSdkContentGenerator} from '../generators/ai-sdk-content-generator.js'

/**
 * Custom fetch wrapper for the ChatGPT OAuth endpoint.
 *
 * The ChatGPT OAuth Responses API has stricter requirements than the standard
 * OpenAI API — certain fields are required and others are rejected:
 * - `instructions` is required (system prompt — defaults to empty)
 * - `store` must be false
 * - `max_output_tokens` is not supported (must be omitted)
 * - `id` fields on input items are rejected
 */
/* eslint-disable n/no-unsupported-features/node-builtins */
export function createChatGptOAuthFetch(): typeof globalThis.fetch {
  return async (input, init) => {
    if (init?.method === 'POST' && init.body) {
      if (typeof init.body !== 'string') {
        return globalThis.fetch(input, init)
      }

      let body: Record<string, unknown>
      try {
        body = JSON.parse(init.body)
      } catch {
        return globalThis.fetch(input, init)
      }

      if (!body.instructions) {
        body.instructions = ''
      }

      body.store = false
      delete body.max_output_tokens

      if (Array.isArray(body.input)) {
        for (const item of body.input) {
          if (typeof item === 'object' && item !== null && 'id' in item) {
            const record: Record<string, unknown> = item
            delete record.id
          }
        }
      }

      init = {...init, body: JSON.stringify(body)}
    }

    return globalThis.fetch(input, init)
  }
}
/* eslint-enable n/no-unsupported-features/node-builtins */

export const openaiProvider: ProviderModule = {
  apiKeyUrl: 'https://platform.openai.com/api-keys',
  authType: 'api-key',
  baseUrl: 'https://api.openai.com/v1',
  category: 'popular',
  createGenerator(config: GeneratorFactoryConfig) {
    const useChatGptOAuth = config.baseUrl === CHATGPT_OAUTH_BASE_URL

    const provider = createOpenAI({
      apiKey: config.apiKey ?? '',
      baseURL: config.baseUrl,
      fetch: useChatGptOAuth ? createChatGptOAuthFetch() : undefined,
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
