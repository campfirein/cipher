import {expect} from 'chai'

import {
  AgentConfigSchema,
  HarnessConfigSchema,
} from '../../../../src/agent/infra/agent/agent-schemas.js'

describe('agent-schemas — harness config block', () => {
  // Minimal valid AgentConfig fixture (covers the required fields).
  const baseConfig = {
    apiBaseUrl: 'https://example.invalid',
    model: 'test-model',
    projectId: 'proj-1',
    storagePath: '/tmp/brv',
  }

  describe('HarnessConfigSchema', () => {
    it('fills missing fields with defaults when parsing an empty object', () => {
      const parsed = HarnessConfigSchema.parse({})
      expect(parsed).to.deep.equal({
        autoLearn: true,
        enabled: false,
        language: 'auto',
        maxVersions: 20,
      })
      expect(parsed.modeOverride).to.equal(undefined)
      expect(parsed.refinementModel).to.equal(undefined)
    })

    it('accepts fully populated config', () => {
      const parsed = HarnessConfigSchema.parse({
        autoLearn: false,
        enabled: true,
        language: 'typescript',
        maxVersions: 50,
        modeOverride: 'filter',
        refinementModel: 'claude-sonnet-4-6',
      })
      expect(parsed).to.deep.equal({
        autoLearn: false,
        enabled: true,
        language: 'typescript',
        maxVersions: 50,
        modeOverride: 'filter',
        refinementModel: 'claude-sonnet-4-6',
      })
    })

    it('rejects unknown modeOverride values', () => {
      expect(() => HarnessConfigSchema.parse({modeOverride: 'supercharged'})).to.throw()
    })

    it('rejects unknown language values', () => {
      expect(() => HarnessConfigSchema.parse({language: 'rust'})).to.throw()
      // 'Typescript' capitalised is not the canonical value
      expect(() => HarnessConfigSchema.parse({language: 'Typescript'})).to.throw()
    })

    it('rejects non-positive maxVersions', () => {
      expect(() => HarnessConfigSchema.parse({maxVersions: 0})).to.throw()
      expect(() => HarnessConfigSchema.parse({maxVersions: -1})).to.throw()
    })

    it('rejects non-integer maxVersions', () => {
      expect(() => HarnessConfigSchema.parse({maxVersions: 1.5})).to.throw()
    })

    it('rejects empty-string refinementModel', () => {
      // Fail-fast — an empty model id would otherwise surface as a confusing
      // provider-SDK error at refinement time.
      expect(() => HarnessConfigSchema.parse({refinementModel: ''})).to.throw()
    })

    it('rejects unknown extra keys (strict)', () => {
      expect(() => HarnessConfigSchema.parse({extra: 'nope'})).to.throw()
    })
  })

  describe('AgentConfigSchema integration', () => {
    it('parses a config without a harness block and defaults to disabled', () => {
      const parsed = AgentConfigSchema.parse(baseConfig)
      expect(parsed.harness).to.deep.equal({
        autoLearn: true,
        enabled: false,
        language: 'auto',
        maxVersions: 20,
      })
    })

    it('parses a config with an explicit harness.enabled = true', () => {
      const parsed = AgentConfigSchema.parse({
        ...baseConfig,
        harness: {enabled: true, language: 'python'},
      })
      expect(parsed.harness.enabled).to.equal(true)
      expect(parsed.harness.language).to.equal('python')
      // Other fields keep their defaults.
      expect(parsed.harness.autoLearn).to.equal(true)
      expect(parsed.harness.maxVersions).to.equal(20)
    })

    it('rejects unknown extra keys inside harness (strict)', () => {
      expect(() =>
        AgentConfigSchema.parse({...baseConfig, harness: {enabled: true, surprise: 'field'}}),
      ).to.throw()
    })
  })
})
