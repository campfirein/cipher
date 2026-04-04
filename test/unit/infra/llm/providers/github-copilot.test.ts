import {expect} from 'chai'

import {AiSdkContentGenerator} from '../../../../../src/agent/infra/llm/generators/ai-sdk-content-generator.js'
import {githubCopilotProvider, isCopilotClaudeModel} from '../../../../../src/agent/infra/llm/providers/github-copilot.js'
import {getProviderModule} from '../../../../../src/agent/infra/llm/providers/index.js'

const BASE_FACTORY_CONFIG = {
  maxTokens: 1024,
  temperature: 0.7,
}

describe('GitHub Copilot Provider', () => {
  describe('module metadata', () => {
    it('should have correct id', () => {
      expect(githubCopilotProvider.id).to.equal('github-copilot')
    })

    it('should have correct providerType', () => {
      expect(githubCopilotProvider.providerType).to.equal('openai')
    })

    it('should be registered in provider modules', () => {
      const module = getProviderModule('github-copilot')
      expect(module).to.equal(githubCopilotProvider)
    })

    it('should have correct default model', () => {
      expect(githubCopilotProvider.defaultModel).to.equal('claude-sonnet-4.6')
    })

    it('should have popular category', () => {
      expect(githubCopilotProvider.category).to.equal('popular')
    })

    it('should have empty envVars (OAuth only)', () => {
      expect(githubCopilotProvider.envVars).to.deep.equal([])
    })
  })

  describe('createGenerator', () => {
    it('should create AiSdkContentGenerator for Claude models', () => {
      const generator = githubCopilotProvider.createGenerator({
        ...BASE_FACTORY_CONFIG,
        apiKey: 'test-token',
        model: 'claude-sonnet-4',
      })
      expect(generator).to.be.instanceOf(AiSdkContentGenerator)
    })

    it('should create AiSdkContentGenerator for GPT models', () => {
      const generator = githubCopilotProvider.createGenerator({
        ...BASE_FACTORY_CONFIG,
        apiKey: 'test-token',
        model: 'gpt-4.1',
      })
      expect(generator).to.be.instanceOf(AiSdkContentGenerator)
    })

    it('should create AiSdkContentGenerator for Gemini models', () => {
      const generator = githubCopilotProvider.createGenerator({
        ...BASE_FACTORY_CONFIG,
        apiKey: 'test-token',
        model: 'gemini-2.5-pro',
      })
      expect(generator).to.be.instanceOf(AiSdkContentGenerator)
    })

    it('should create AiSdkContentGenerator for o-series models', () => {
      const generator = githubCopilotProvider.createGenerator({
        ...BASE_FACTORY_CONFIG,
        apiKey: 'test-token',
        model: 'o3',
      })
      expect(generator).to.be.instanceOf(AiSdkContentGenerator)
    })

    it('should use Copilot base URL by default', () => {
      const generator = githubCopilotProvider.createGenerator({
        ...BASE_FACTORY_CONFIG,
        apiKey: 'test-token',
        model: 'claude-sonnet-4',
      })
      expect(generator).to.be.instanceOf(AiSdkContentGenerator)
    })

    it('should use custom base URL when provided in config', () => {
      const generator = githubCopilotProvider.createGenerator({
        ...BASE_FACTORY_CONFIG,
        apiKey: 'test-token',
        baseUrl: 'https://custom.api.example.com',
        model: 'claude-sonnet-4',
      })
      expect(generator).to.be.instanceOf(AiSdkContentGenerator)
    })

    it('should use OpenAI-compatible format for all models including Claude', () => {
      const claudeGen = githubCopilotProvider.createGenerator({
        ...BASE_FACTORY_CONFIG,
        apiKey: 'test-token',
        model: 'claude-sonnet-4',
      })
      const gptGen = githubCopilotProvider.createGenerator({
        ...BASE_FACTORY_CONFIG,
        apiKey: 'test-token',
        model: 'gpt-4.1',
      })
      expect(claudeGen).to.be.instanceOf(AiSdkContentGenerator)
      expect(gptGen).to.be.instanceOf(AiSdkContentGenerator)
    })
  })

  describe('isCopilotClaudeModel()', () => {
    it('should return true for claude-sonnet-4', () => {
      expect(isCopilotClaudeModel('claude-sonnet-4')).to.be.true
    })

    it('should return true for claude-opus-4.5', () => {
      expect(isCopilotClaudeModel('claude-opus-4.5')).to.be.true
    })

    it('should return true for claude-haiku-4.5', () => {
      expect(isCopilotClaudeModel('claude-haiku-4.5')).to.be.true
    })

    it('should return false for gpt-4.1', () => {
      expect(isCopilotClaudeModel('gpt-4.1')).to.be.false
    })

    it('should return false for gemini-2.5-pro', () => {
      expect(isCopilotClaudeModel('gemini-2.5-pro')).to.be.false
    })

    it('should return false for o3', () => {
      expect(isCopilotClaudeModel('o3')).to.be.false
    })
  })
})
