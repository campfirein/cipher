import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {
  CodeExecOutcome,
  HarnessVersion,
} from '../../../../../src/agent/core/domain/harness/types.js'
import type {IHarnessStore} from '../../../../../src/agent/core/interfaces/i-harness-store.js'

import {
  buildStatusReport,
  renderStatusText,
  type StatusInputs,
} from '../../../../../src/oclif/commands/harness/status.js'

const PROJECT_ID = '/fixture/proj'

function makeVersion(overrides: Partial<HarnessVersion> = {}): HarnessVersion {
  return {
    code: 'exports.curate = async () => {}',
    commandType: 'curate',
    createdAt: 1_700_000_000_000,
    heuristic: 0.62,
    id: 'v-abc',
    metadata: {
      capabilities: ['curate'],
      commandType: 'curate',
      projectPatterns: ['**/*'],
      version: 1,
    },
    projectId: PROJECT_ID,
    projectType: 'typescript',
    version: 1,
    ...overrides,
  }
}

function makeOutcome(overrides: Partial<CodeExecOutcome> = {}): CodeExecOutcome {
  return {
    code: 'ctx.tools.curate([])',
    commandType: 'curate',
    executionTimeMs: 12,
    id: 'o-x',
    projectId: PROJECT_ID,
    projectType: 'typescript',
    sessionId: 's-x',
    success: true,
    timestamp: 1_700_000_000_000,
    usedHarness: false,
    ...overrides,
  }
}

function makeStoreStub(sb: SinonSandbox): IHarnessStore {
  return {
    deleteOutcome: sb.stub(),
    deleteOutcomes: sb.stub(),
    deletePin: sb.stub().resolves(false),
    deleteScenario: sb.stub(),
    deleteScenarios: sb.stub(),
    deleteVersion: sb.stub(),
    getLatest: sb.stub(),
    getPin: sb.stub(),
    getVersion: sb.stub(),
    listOutcomes: sb.stub(),
    listScenarios: sb.stub(),
    listVersions: sb.stub(),
    pruneOldVersions: sb.stub(),
    recordFeedback: sb.stub(),
    saveOutcome: sb.stub(),
    saveScenario: sb.stub(),
    saveVersion: sb.stub(),
    setPin: sb.stub(),
  } satisfies IHarnessStore
}

function makeInputs(overrides: Partial<StatusInputs> = {}): StatusInputs {
  return {
    commandType: 'curate',
    featureConfig: {autoLearn: true, enabled: true},
    projectId: PROJECT_ID,
    store: undefined,
    ...overrides,
  }
}

describe('HarnessStatus command — buildStatusReport + renderStatusText', () => {
  describe('buildStatusReport', () => {
    let sb: SinonSandbox

    beforeEach(() => {
      sb = createSandbox()
    })

    afterEach(() => {
      sb.restore()
    })

    it('1. no store (fresh project) → enabled flag only, empty counters', async () => {
      const report = await buildStatusReport(
        makeInputs({featureConfig: {autoLearn: true, enabled: false}}),
      )
      expect(report.enabled).to.equal(false)
      expect(report.currentVersionId).to.equal(null)
      expect(report.currentVersion).to.equal(null)
      expect(report.heuristic).to.equal(null)
      expect(report.mode).to.equal(null)
      expect(report.outcomeCount).to.equal(0)
      expect(report.lastRefinement).to.equal(undefined)
    })

    it('2. store present but no version → outcomeCount populated, version fields null', async () => {
      const store = makeStoreStub(sb)
      ;(store.getLatest as SinonStub).resolves()
      ;(store.listVersions as SinonStub).resolves([])
      ;(store.listOutcomes as SinonStub).resolves([
        makeOutcome({id: 'o1'}),
        makeOutcome({id: 'o2', userFeedback: 'good'}),
      ])

      const report = await buildStatusReport(makeInputs({store}))

      expect(report.currentVersionId).to.equal(null)
      expect(report.outcomeCount).to.equal(2)
      expect(report.outcomesWithFeedback).to.equal(1)
      expect(report.mode).to.equal(null)
    })

    it('3. loaded version H=0.62 → mode="filter" (B floor 0.60)', async () => {
      const store = makeStoreStub(sb)
      const v1 = makeVersion({id: 'v-a', version: 1})
      ;(store.getLatest as SinonStub).resolves(v1)
      ;(store.listVersions as SinonStub).resolves([v1])
      ;(store.listOutcomes as SinonStub).resolves([])

      const report = await buildStatusReport(makeInputs({store}))

      expect(report.currentVersionId).to.equal('v-a')
      expect(report.currentVersion).to.equal(1)
      expect(report.heuristic).to.equal(0.62)
      expect(report.mode).to.equal('filter')
      expect(report.lastRefinement).to.equal(undefined)
    })

    it('4. heuristic below 0.30 → mode=null', async () => {
      const store = makeStoreStub(sb)
      const v1 = makeVersion({heuristic: 0.1})
      ;(store.getLatest as SinonStub).resolves(v1)
      ;(store.listVersions as SinonStub).resolves([v1])
      ;(store.listOutcomes as SinonStub).resolves([])

      const report = await buildStatusReport(makeInputs({store}))
      expect(report.mode).to.equal(null)
    })

    it('5. refinement present → lastRefinement populated with deltaH', async () => {
      const store = makeStoreStub(sb)
      const v1 = makeVersion({heuristic: 0.5, id: 'v-a', version: 1})
      const v2 = makeVersion({
        createdAt: 1_700_000_100_000,
        heuristic: 0.62,
        id: 'v-b',
        parentId: 'v-a',
        version: 2,
      })
      ;(store.getLatest as SinonStub).resolves(v2)
      ;(store.listVersions as SinonStub).resolves([v2, v1]) // newest-first per listVersions contract
      ;(store.listOutcomes as SinonStub).resolves([])

      const report = await buildStatusReport(makeInputs({store}))

      expect(report.lastRefinement).to.deep.equal({
        acceptedAt: 1_700_000_100_000,
        deltaH: 0.12,
        fromVersion: 1,
        toVersion: 2,
      })
    })

    it('6. only v1 bootstrap (no parentId) → lastRefinement undefined', async () => {
      const store = makeStoreStub(sb)
      const v1 = makeVersion()
      ;(store.getLatest as SinonStub).resolves(v1)
      ;(store.listVersions as SinonStub).resolves([v1])
      ;(store.listOutcomes as SinonStub).resolves([])

      const report = await buildStatusReport(makeInputs({store}))
      expect(report.lastRefinement).to.equal(undefined)
    })

    it('7. listOutcomes is invoked with MAX_SAFE_INTEGER so the count is accurate', async () => {
      const store = makeStoreStub(sb)
      const listOutcomes = store.listOutcomes as SinonStub
      ;(store.getLatest as SinonStub).resolves()
      ;(store.listVersions as SinonStub).resolves([])
      listOutcomes.resolves([])

      await buildStatusReport(makeInputs({store}))

      expect(listOutcomes.calledOnce).to.equal(true)
      expect(listOutcomes.firstCall.args[2]).to.equal(Number.MAX_SAFE_INTEGER)
    })
  })

  describe('renderStatusText', () => {
    it('renders a disabled + no-version report in the expected shape', () => {
    const text = renderStatusText({
      autoLearn: true,
      commandType: 'curate',
      currentVersion: null,
      currentVersionId: null,
      enabled: false,
      heuristic: null,
      mode: null,
      outcomeCount: 0,
      outcomesWithFeedback: 0,
      projectId: PROJECT_ID,
    })

    expect(text).to.include('harness: disabled')
    expect(text).to.include(`project: ${PROJECT_ID}`)
    expect(text).to.include('version: <none')
  })

  it('renders a loaded version with H, mode, and last-refinement line', () => {
    const text = renderStatusText({
      autoLearn: true,
      commandType: 'curate',
      currentVersion: 3,
      currentVersionId: 'v-abc',
      enabled: true,
      heuristic: 0.64,
      lastRefinement: {
        acceptedAt: Date.now() - 2 * 3_600_000, // 2h ago
        deltaH: 0.06,
        fromVersion: 2,
        toVersion: 3,
      },
      mode: 'filter',
      outcomeCount: 47,
      outcomesWithFeedback: 5,
      projectId: PROJECT_ID,
    })

    expect(text).to.match(/harness: enabled/)
    expect(text).to.match(/version: v-abc \(#3\)\s+H: 0\.64\s+mode: filter/)
    expect(text).to.include('outcomes: 47 recorded (5 w/ feedback)')
    expect(text).to.match(/last refinement: accepted 2h ago\s+v2 → v3\s+ΔH: \+0\.06/)
  })
  })
})
