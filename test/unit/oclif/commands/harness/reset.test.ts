/**
 * Unit tests for `brv harness reset`.
 *
 * Tests the pure logic functions (countArtifacts, executeReset,
 * renderResetText) extracted from the command. The oclif `run()` method
 * and interactive prompt are tested via the integration test.
 */

import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {
  EvaluationScenario,
  HarnessVersion,
} from '../../../../../src/agent/core/domain/harness/types.js'
import type {IHarnessStore} from '../../../../../src/agent/core/interfaces/i-harness-store.js'

import {
  countArtifacts,
  executeReset,
  renderResetText,
} from '../../../../../src/oclif/commands/harness/reset.js'

const PROJECT_ID = '/fixture/proj'

function makeVersion(overrides: Partial<HarnessVersion> = {}): HarnessVersion {
  return {
    code: 'exports.curate = async () => {}',
    commandType: 'curate',
    createdAt: 1_700_000_000_000,
    heuristic: 0.5,
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

function makeScenario(overrides: Partial<EvaluationScenario> = {}): EvaluationScenario {
  return {
    code: 'ctx.tools.curate([])',
    commandType: 'curate',
    createdAt: 1_700_000_000_000,
    expectedBehavior: 'Succeeds without errors',
    id: 's-abc',
    projectId: PROJECT_ID,
    projectType: 'typescript',
    taskDescription: 'Test scenario',
    ...overrides,
  }
}

function makeStoreStub(sb: SinonSandbox): IHarnessStore {
  return {
    deleteOutcome: sb.stub(),
    deleteOutcomes: sb.stub().resolves(0),
    deletePin: sb.stub().resolves(false),
    deleteScenario: sb.stub(),
    deleteScenarios: sb.stub().resolves(0),
    deleteVersion: sb.stub().resolves(true),
    getLatest: sb.stub(),
    getPin: sb.stub().resolves(),
    getVersion: sb.stub(),
    listOutcomes: sb.stub().resolves([]),
    listScenarios: sb.stub().resolves([]),
    listVersions: sb.stub().resolves([]),
    pruneOldVersions: sb.stub(),
    recordFeedback: sb.stub(),
    saveOutcome: sb.stub(),
    saveScenario: sb.stub(),
    saveVersion: sb.stub(),
    setPin: sb.stub().resolves(),
  } satisfies IHarnessStore
}

describe('HarnessReset command — countArtifacts + executeReset + renderResetText', () => {
  let sb: SinonSandbox

  beforeEach(() => {
    sb = createSandbox()
  })

  afterEach(() => {
    sb.restore()
  })

  // Test 1: reset when nothing exists → counts are all zero
  it('countArtifacts returns zero counts when no artifacts exist', async () => {
    const store = makeStoreStub(sb)

    const counts = await countArtifacts(store, PROJECT_ID, 'curate')

    expect(counts.outcomes).to.equal(0)
    expect(counts.scenarios).to.equal(0)
    expect(counts.versions).to.equal(0)
  })

  // Test 2: countArtifacts returns correct counts from store
  it('countArtifacts returns correct counts from store queries', async () => {
    const store = makeStoreStub(sb)
    ;(store.listVersions as SinonStub).resolves([
      makeVersion({id: 'v-1', version: 1}),
      makeVersion({id: 'v-2', version: 2}),
    ])
    ;(store.listOutcomes as SinonStub).resolves([{id: 'o-1'}, {id: 'o-2'}, {id: 'o-3'}])
    ;(store.listScenarios as SinonStub).resolves([makeScenario()])

    const counts = await countArtifacts(store, PROJECT_ID, 'curate')

    expect(counts.versions).to.equal(2)
    expect(counts.outcomes).to.equal(3)
    expect(counts.scenarios).to.equal(1)
  })

  // Test 3: executeReset deletes versions + outcomes + scenarios in order
  it('executeReset deletes outcomes, scenarios, and versions', async () => {
    const store = makeStoreStub(sb)
    const v1 = makeVersion({id: 'v-1', version: 1})
    const v2 = makeVersion({id: 'v-2', version: 2})
    ;(store.listVersions as SinonStub).resolves([v2, v1])
    ;(store.deleteOutcomes as SinonStub).resolves(5)
    ;(store.deleteScenarios as SinonStub).resolves(3)
    ;(store.deleteVersion as SinonStub).resolves(true)

    const result = await executeReset(store, PROJECT_ID, 'curate')

    expect(result.outcomes).to.equal(5)
    expect(result.scenarios).to.equal(3)
    expect(result.versions).to.equal(2)

    // deleteOutcomes called
    expect((store.deleteOutcomes as SinonStub).calledOnce).to.equal(true)
    expect((store.deleteOutcomes as SinonStub).firstCall.args).to.deep.equal([PROJECT_ID, 'curate'])

    // deleteScenarios called
    expect((store.deleteScenarios as SinonStub).calledOnce).to.equal(true)

    // deleteVersion called for each version
    expect((store.deleteVersion as SinonStub).callCount).to.equal(2)
    expect((store.deleteVersion as SinonStub).firstCall.args).to.deep.equal([PROJECT_ID, 'curate', 'v-2'])
    expect((store.deleteVersion as SinonStub).secondCall.args).to.deep.equal([PROJECT_ID, 'curate', 'v-1'])

    // Deletion order: outcomes before versions
    expect((store.deleteOutcomes as SinonStub).calledBefore(store.deleteVersion as SinonStub)).to.equal(true)

    // Pin cleared
    expect((store.deletePin as SinonStub).calledOnce).to.equal(true)
  })

  // Test 4: executeReset with nothing to delete returns zero counts
  it('executeReset with empty store returns zero counts', async () => {
    const store = makeStoreStub(sb)

    const result = await executeReset(store, PROJECT_ID, 'curate')

    expect(result.outcomes).to.equal(0)
    expect(result.scenarios).to.equal(0)
    expect(result.versions).to.equal(0)
  })

  // Test 5: renderResetText with deletions shows counts
  it('renderResetText shows deletion counts', () => {
    const text = renderResetText({outcomes: 47, scenarios: 12, versions: 3})

    expect(text).to.include('3 version')
    expect(text).to.include('47 outcome')
    expect(text).to.include('12 scenario')
  })

  // Test 6: renderResetText with nothing deleted shows appropriate message
  it('renderResetText with zero counts shows nothing-to-delete message', () => {
    const text = renderResetText({outcomes: 0, scenarios: 0, versions: 0})

    expect(text).to.match(/nothing to delete/i)
  })
})
