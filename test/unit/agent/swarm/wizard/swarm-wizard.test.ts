/* eslint-disable camelcase -- mock provider configs use YAML snake_case keys */
import {expect} from 'chai'

import type {DetectedProvider} from '../../../../../src/agent/infra/swarm/wizard/provider-detector.js'

import {
  EscBackError,
  type MemoryWizardPrompts,
  runMemoryWizard,
  WizardCancelledError,
} from '../../../../../src/agent/infra/swarm/wizard/swarm-wizard.js'

/**
 * Create mock prompts that return pre-defined answers.
 */
/**
 * Create mock prompts that return pre-defined answers.
 * selectProviders returns indices into the detected array (as strings).
 */
function createMockPrompts(overrides?: Partial<MemoryWizardPrompts>): MemoryWizardPrompts {
  return {
    configureBudget: overrides?.configureBudget ??
      (async () => ({globalMonthlyCents: 5000})),
    configureProvider: overrides?.configureProvider ??
      (async () => ({})),
    confirmWrite: overrides?.confirmWrite ??
      (async () => true),
    selectProviders: overrides?.selectProviders ??
      (async () => ['0']),  // index 0 = byterover in createDetected()
  }
}

function createDetected(): DetectedProvider[] {
  return [
    {detected: true, id: 'byterover', type: 'local'},
    {detected: true, id: 'obsidian', noteCount: 100, path: '~/Documents/MyVault', type: 'local'},
    {detected: true, envVar: 'HONCHO_API_KEY', id: 'honcho', type: 'cloud'},
  ]
}

describe('runMemoryWizard', () => {
  it('returns wizard answers with selected providers', async () => {
    const prompts = createMockPrompts({
      async configureProvider(provider) {
        if (provider.id === 'obsidian') {
          return {vault_path: '~/Documents/MyVault'}
        }

        return {}
      },
      selectProviders: async () => ['0', '1'],  // byterover, obsidian
    })
    const detected = createDetected()
    const result = await runMemoryWizard(prompts, detected)

    expect(result.providers).to.have.length(2)
    expect(result.providers[0].id).to.equal('byterover')
    expect(result.providers[1].id).to.equal('obsidian')
    expect(result.providers[1].config).to.deep.include({vault_path: '~/Documents/MyVault'})
  })

  it('skips budget step when no cloud providers selected', async () => {
    let budgetCalled = false
    const prompts = createMockPrompts({
      async configureBudget() {
        budgetCalled = true

        return {globalMonthlyCents: 5000}
      },
      selectProviders: async () => ['0'],  // byterover only
    })
    const detected = createDetected()
    const result = await runMemoryWizard(prompts, detected)

    expect(budgetCalled).to.be.false
    expect(result.budget).to.be.undefined
  })

  it('includes budget when cloud providers are selected', async () => {
    const prompts = createMockPrompts({
      configureBudget: async () => ({globalMonthlyCents: 3000}),
      selectProviders: async () => ['0', '2'],  // byterover, honcho
    })
    const detected = createDetected()
    const result = await runMemoryWizard(prompts, detected)

    expect(result.budget).to.deep.equal({globalMonthlyCents: 3000})
  })

  it('calls configureProvider for each selected non-byterover provider', async () => {
    const configured: string[] = []
    const prompts = createMockPrompts({
      async configureProvider(provider) {
        configured.push(provider.id)

        return {}
      },
      selectProviders: async () => ['0', '1', '2'],  // byterover, obsidian, honcho
    })
    const detected = createDetected()
    await runMemoryWizard(prompts, detected)

    expect(configured).to.include('obsidian')
    expect(configured).to.include('honcho')
    expect(configured).to.not.include('byterover')
  })

  it('throws WizardCancelledError when user declines to write', async () => {
    const prompts = createMockPrompts({
      confirmWrite: async () => false,
    })
    const detected = createDetected()
    try {
      await runMemoryWizard(prompts, detected)
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).to.be.instanceOf(WizardCancelledError)
    }
  })

  it('handles multiple detected entries with the same provider id', async () => {
    const multiDetected: DetectedProvider[] = [
      {detected: true, id: 'byterover', type: 'local'},
      {detected: true, id: 'obsidian', noteCount: 50, path: '~/Vault1', type: 'local'},
      {detected: true, id: 'obsidian', noteCount: 80, path: '~/Vault2', type: 'local'},
    ]
    const configured: string[] = []
    const prompts = createMockPrompts({
      async configureProvider(provider) {
        configured.push(provider.path ?? provider.id)

        return {vault_path: provider.path}
      },
      // Select both vaults by index
      selectProviders: async () => ['1', '2'],
    })
    const result = await runMemoryWizard(prompts, multiDetected)

    // Both vaults should appear
    const obsidianEntries = result.providers.filter((p) => p.id === 'obsidian')
    expect(obsidianEntries).to.have.length(2)
    expect(configured).to.include('~/Vault1')
    expect(configured).to.include('~/Vault2')
  })

  it('byterover is always enabled even if not explicitly selected', async () => {
    const prompts = createMockPrompts({
      configureProvider: async () => ({vault_path: '~/vault'}),
      selectProviders: async () => ['1'],  // obsidian (no byterover — should auto-add)
    })
    const detected = createDetected()
    const result = await runMemoryWizard(prompts, detected)

    const brv = result.providers.find((p) => p.id === 'byterover')
    expect(brv).to.exist
    expect(brv!.enabled).to.be.true
  })

  it('includes duplicate-provider warnings in the confirm summary', async () => {
    const multiDetected: DetectedProvider[] = [
      {detected: true, id: 'byterover', type: 'local'},
      {detected: true, id: 'obsidian', noteCount: 50, path: '~/Vault1', type: 'local'},
      {detected: true, id: 'obsidian', noteCount: 80, path: '~/Vault2', type: 'local'},
    ]
    let receivedSummary = ''
    const prompts = createMockPrompts({
      configureProvider: async (p) => ({vault_path: p.path}),
      async confirmWrite(summary) {
        receivedSummary = summary

        return true
      },
      selectProviders: async () => ['0', '1', '2'],
    })
    await runMemoryWizard(prompts, multiDetected)

    // The summary shown at confirm should warn about the dropped vault
    expect(receivedSummary).to.include('~/Vault1')
    expect(receivedSummary).to.include('only supports one')
  })

  it('retries selectProviders when EscBack is thrown from configureProvider', async () => {
    let selectCallCount = 0
    const prompts = createMockPrompts({
      async configureProvider() {
        if (selectCallCount === 1) {
          // First configure attempt: simulate ESC back
          throw new EscBackError()
        }

        return {vault_path: '~/vault'}
      },
      async selectProviders() {
        selectCallCount++
        // Always select obsidian
        return ['0', '1']
      },
    })
    const detected = createDetected()
    const result = await runMemoryWizard(prompts, detected)

    // Should have been called twice (original + retry after ESC)
    expect(selectCallCount).to.equal(2)
    expect(result.providers).to.have.length(2)
  })

  it('retries configureBudget on EscBack by going back to configure step', async () => {
    let budgetCallCount = 0
    const prompts = createMockPrompts({
      async configureBudget() {
        budgetCallCount++
        if (budgetCallCount === 1) {
          throw new EscBackError()
        }

        return {globalMonthlyCents: 5000}
      },
      configureProvider: async () => ({}),
      selectProviders: async () => ['0', '2'],  // byterover + honcho
    })
    const detected = createDetected()
    const result = await runMemoryWizard(prompts, detected)

    // Budget retried after ESC → re-ran configure → budget again
    expect(budgetCallCount).to.equal(2)
    expect(result.budget).to.deep.equal({globalMonthlyCents: 5000})
  })
})
