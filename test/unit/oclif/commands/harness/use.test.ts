import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {HarnessVersion} from '../../../../../src/agent/core/domain/harness/types.js'
import type {IHarnessStore} from '../../../../../src/agent/core/interfaces/i-harness-store.js'

import {
  applyPin,
  renderUseText,
  type UseReport,
} from '../../../../../src/oclif/commands/harness/use.js'

const PROJECT_ID = '/fixture/proj'

function makeVersion(overrides: Partial<HarnessVersion> = {}): HarnessVersion {
  return {
    code: 'exports.curate = async () => {}',
    commandType: 'curate',
    createdAt: 1_700_000_000_000,
    heuristic: 0.62,
    id: 'v-pin-me',
    metadata: {
      capabilities: ['curate'],
      commandType: 'curate',
      projectPatterns: ['**/*'],
      version: 1,
    },
    projectId: PROJECT_ID,
    projectType: 'typescript',
    version: 2,
    ...overrides,
  }
}

function makeStoreStub(sb: SinonSandbox): IHarnessStore {
  return {
    deleteOutcome: sb.stub(),
    deleteOutcomes: sb.stub(),
    deleteScenario: sb.stub(),
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

describe('HarnessUse command — applyPin + renderUseText', () => {
  describe('applyPin', () => {
    let sb: SinonSandbox

    beforeEach(() => {
      sb = createSandbox()
    })

    afterEach(() => {
      sb.restore()
    })

    it('1. writes a HarnessPin and returns the correct mode for pinned H', async () => {
      const store = makeStoreStub(sb)
      const setPin = store.setPin as SinonStub
      setPin.resolves()
      const pinned = makeVersion({heuristic: 0.9, id: 'v-hi'})

      const report = await applyPin({
        commandType: 'curate',
        pinnedVersion: pinned,
        previousVersionId: 'v-old',
        projectId: PROJECT_ID,
        store,
      })

      expect(setPin.calledOnce).to.equal(true)
      const pinRecord = setPin.firstCall.args[0]
      expect(pinRecord.projectId).to.equal(PROJECT_ID)
      expect(pinRecord.commandType).to.equal('curate')
      expect(pinRecord.pinnedVersionId).to.equal('v-hi')
      expect(pinRecord.pinnedAt).to.be.a('number')

      // H=0.9 ≥ 0.85 floor → policy mode.
      expect(report.newMode).to.equal('policy')
      expect(report.pinnedVersionId).to.equal('v-hi')
      expect(report.previousVersionId).to.equal('v-old')
    })

    it('2. mode is null when pinned H falls below Mode A floor', async () => {
      const store = makeStoreStub(sb)
      ;(store.setPin as SinonStub).resolves()
      const pinned = makeVersion({heuristic: 0.2, id: 'v-low'})

      const report = await applyPin({
        commandType: 'curate',
        pinnedVersion: pinned,
        previousVersionId: null,
        projectId: PROJECT_ID,
        store,
      })

      // Mode field is still present (explicit null) per task note,
      // so scripts can access `newMode` reliably.
      expect(report.newMode).to.equal(null)
      expect(report.previousVersionId).to.equal(null)
    })

    it('3. mode="filter" for H=0.65 (B floor 0.60, C floor 0.85)', async () => {
      const store = makeStoreStub(sb)
      ;(store.setPin as SinonStub).resolves()
      const pinned = makeVersion({heuristic: 0.65})

      const report = await applyPin({
        commandType: 'curate',
        pinnedVersion: pinned,
        previousVersionId: null,
        projectId: PROJECT_ID,
        store,
      })

      expect(report.newMode).to.equal('filter')
    })
  })

  describe('renderUseText', () => {
    it('1. renders the transition with mode line', () => {
      const report: UseReport = {
        newMode: 'filter',
        pinnedVersionId: 'v-abc',
        previousVersionId: 'v-xyz',
      }
      const text = renderUseText(report)
      expect(text).to.include('pinned: v-abc')
      expect(text).to.include('was:    v-xyz')
      expect(text).to.include('mode:   filter')
      expect(text).to.include('brv harness use latest')
    })

    it('2. previousVersionId null renders as "<none>"', () => {
      const text = renderUseText({
        newMode: null,
        pinnedVersionId: 'v-abc',
        previousVersionId: null,
      })
      expect(text).to.include('was:    <none>')
      expect(text).to.include('below Mode A floor')
    })
  })
})
