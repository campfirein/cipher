import {expect} from 'chai'

import type {ProviderConfigResponse} from '../../../../src/server/core/domain/transport/schemas.js'

import {TaskErrorCode} from '../../../../src/server/core/domain/errors/task-error.js'
import {validateProviderForTask} from '../../../../src/server/infra/daemon/task-validation.js'

// ============================================================================
// Helpers
// ============================================================================

function createConfig(overrides: Partial<ProviderConfigResponse> = {}): ProviderConfigResponse {
  return {
    activeProvider: 'byterover',
    ...overrides,
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('validateProviderForTask', () => {
  describe('no provider connected', () => {
    it('should return error when activeProvider is empty string', () => {
      const result = validateProviderForTask(createConfig({activeProvider: ''}))

      expect(result).to.not.be.undefined
      expect(result!.message).to.include('No provider connected')
      expect(result!.code).to.equal(TaskErrorCode.PROVIDER_NOT_CONFIGURED)
      expect(result!.name).to.equal('TaskError')
    })

    it('should return error when activeProvider is falsy', () => {
      const result = validateProviderForTask(createConfig({activeProvider: undefined as unknown as string}))

      expect(result).to.not.be.undefined
      expect(result!.message).to.include('No provider connected')
    })
  })

  describe('provider key missing', () => {
    it('should report API key missing for api-key auth method', () => {
      const result = validateProviderForTask(createConfig({
        activeProvider: 'openrouter',
        authMethod: 'api-key',
        providerKeyMissing: true,
      }))

      expect(result).to.not.be.undefined
      expect(result!.message).to.include('API key is missing')
      expect(result!.message).to.include('openrouter')
      expect(result!.code).to.equal(TaskErrorCode.PROVIDER_NOT_CONFIGURED)
    })

    it('should report authentication expired for oauth auth method', () => {
      const result = validateProviderForTask(createConfig({
        activeProvider: 'openai',
        authMethod: 'oauth',
        providerKeyMissing: true,
      }))

      expect(result).to.not.be.undefined
      expect(result!.message).to.include('authentication has expired')
      expect(result!.message).to.include('openai')
    })

    it('should include model info when activeModel is set', () => {
      const result = validateProviderForTask(createConfig({
        activeModel: 'gpt-4o',
        activeProvider: 'openai',
        providerKeyMissing: true,
      }))

      expect(result).to.not.be.undefined
      expect(result!.message).to.include('(model: gpt-4o)')
    })

    it('should not include model info when activeModel is not set', () => {
      const result = validateProviderForTask(createConfig({
        activeProvider: 'openai',
        providerKeyMissing: true,
      }))

      expect(result).to.not.be.undefined
      expect(result!.message).to.not.include('(model:')
    })
  })

  describe('auth required', () => {
    it('should return error when authRequired is true', () => {
      const result = validateProviderForTask(createConfig({
        authRequired: true,
      }))

      expect(result).to.not.be.undefined
      expect(result!.message).to.include('requires authentication')
      expect(result!.code).to.equal(TaskErrorCode.PROVIDER_NOT_CONFIGURED)
      expect(result!.name).to.equal('TaskError')
    })
  })

  describe('valid config', () => {
    it('should return undefined when all checks pass', () => {
      const result = validateProviderForTask(createConfig({
        activeProvider: 'openrouter',
      }))

      expect(result).to.be.undefined
    })

    it('should return undefined for byterover with no auth required', () => {
      const result = validateProviderForTask(createConfig({
        activeProvider: 'byterover',
        authRequired: false,
      }))

      expect(result).to.be.undefined
    })
  })

  describe('priority order', () => {
    it('should check no-provider before key-missing', () => {
      const result = validateProviderForTask(createConfig({
        activeProvider: '',
        providerKeyMissing: true,
      }))

      expect(result!.message).to.include('No provider connected')
    })

    it('should check key-missing before auth-required', () => {
      const result = validateProviderForTask(createConfig({
        activeProvider: 'openai',
        authRequired: true,
        providerKeyMissing: true,
      }))

      expect(result!.message).to.not.include('requires authentication')
      expect(
        result!.message.includes('API key is missing') || result!.message.includes('authentication has expired'),
      ).to.be.true
    })
  })
})
