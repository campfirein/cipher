import {expect} from 'chai'

import type {
  CodeExecOutcome,
  EvaluationScenario,
  HarnessVersion,
} from '../../src/agent/core/domain/harness/types.js'

import {
  HarnessStoreError,
  HarnessStoreErrorCode,
} from '../../src/agent/core/domain/errors/harness-store-error.js'
import {InMemoryHarnessStore} from './in-memory-harness-store.js'

function makeVersion(overrides: Partial<HarnessVersion> = {}): HarnessVersion {
  return {
    code: 'function meta(){return {}}',
    commandType: 'curate',
    createdAt: 1_700_000_000_000,
    heuristic: 0.5,
    id: 'v-default',
    metadata: {
      capabilities: ['curate'],
      commandType: 'curate',
      projectPatterns: [],
      version: 1,
    },
    projectId: 'p',
    projectType: 'typescript',
    version: 1,
    ...overrides,
  }
}

function makeOutcome(overrides: Partial<CodeExecOutcome> = {}): CodeExecOutcome {
  return {
    code: 'tools.search("x")',
    commandType: 'curate',
    executionTimeMs: 10,
    id: 'o-default',
    projectId: 'p',
    projectType: 'typescript',
    sessionId: 's',
    success: true,
    timestamp: 1_700_000_000_000,
    usedHarness: false,
    ...overrides,
  }
}

function makeScenario(overrides: Partial<EvaluationScenario> = {}): EvaluationScenario {
  return {
    code: 'tools.search("x")',
    commandType: 'curate',
    createdAt: Date.now(),
    expectedBehavior: 'returns results',
    id: 's-default',
    projectId: 'p',
    projectType: 'typescript',
    taskDescription: 'find auth module',
    ...overrides,
  }
}

describe('InMemoryHarnessStore', () => {
  it('saveVersion + getLatest round-trips and returns the just-saved entry', async () => {
    const store = new InMemoryHarnessStore()
    const v = makeVersion({id: 'v1', version: 1})
    await store.saveVersion(v)

    const latest = await store.getLatest('p', 'curate')
    expect(latest).to.deep.equal(v)
  })

  it('saveVersion twice with the same id throws VERSION_CONFLICT with details.id', async () => {
    const store = new InMemoryHarnessStore()
    await store.saveVersion(makeVersion({id: 'v1', version: 1}))

    try {
      await store.saveVersion(makeVersion({id: 'v1', version: 2}))
      expect.fail('expected throw')
    } catch (error) {
      expect(HarnessStoreError.isCode(error, HarnessStoreErrorCode.VERSION_CONFLICT)).to.equal(true)
      if (!HarnessStoreError.isHarnessStoreError(error)) expect.fail('not a HarnessStoreError')
      expect(error.details?.id).to.equal('v1')
    }
  })

  it('saveVersion twice with the same (projectId, commandType, version) throws with details.version', async () => {
    const store = new InMemoryHarnessStore()
    await store.saveVersion(makeVersion({id: 'v1', version: 1}))

    try {
      await store.saveVersion(makeVersion({id: 'v2', version: 1}))
      expect.fail('expected throw')
    } catch (error) {
      expect(HarnessStoreError.isCode(error, HarnessStoreErrorCode.VERSION_CONFLICT)).to.equal(true)
      if (!HarnessStoreError.isHarnessStoreError(error)) expect.fail('not a HarnessStoreError')
      expect(error.details?.version).to.equal(1)
    }
  })

  it('listOutcomes returns newest first by timestamp and respects limit', async () => {
    const store = new InMemoryHarnessStore()
    const old = makeOutcome({id: 'o-old', timestamp: 1000})
    const mid = makeOutcome({id: 'o-mid', timestamp: 2000})
    const newest = makeOutcome({id: 'o-new', timestamp: 3000})
    await store.saveOutcome(old)
    await store.saveOutcome(newest)
    await store.saveOutcome(mid)

    const all = await store.listOutcomes('p', 'curate')
    expect(all.map((o) => o.id)).to.deep.equal(['o-new', 'o-mid', 'o-old'])

    const top2 = await store.listOutcomes('p', 'curate', 2)
    expect(top2.map((o) => o.id)).to.deep.equal(['o-new', 'o-mid'])
  })

  it('recordFeedback sets the field on the named outcome; no-op on miss', async () => {
    const store = new InMemoryHarnessStore()
    await store.saveOutcome(makeOutcome({id: 'o1'}))

    await store.recordFeedback('p', 'curate', 'o1', 'bad')
    const [after] = await store.listOutcomes('p', 'curate')
    expect(after.userFeedback).to.equal('bad')

    await store.recordFeedback('p', 'curate', 'does-not-exist', 'good')
    // no-op — the stored outcome is unchanged
    const [stillBad] = await store.listOutcomes('p', 'curate')
    expect(stillBad.userFeedback).to.equal('bad')

    await store.recordFeedback('p', 'curate', 'o1', null)
    const [cleared] = await store.listOutcomes('p', 'curate')
    expect(cleared.userFeedback).to.equal(null)
  })

  it('saveScenario + listScenarios round-trips', async () => {
    const store = new InMemoryHarnessStore()
    const s = makeScenario({id: 's1'})
    await store.saveScenario(s)

    const list = await store.listScenarios('p', 'curate')
    expect(list).to.deep.equal([s])
  })

  it('deleteOutcomes returns the count of deleted entries and leaves other partitions intact', async () => {
    const store = new InMemoryHarnessStore()
    await store.saveOutcome(makeOutcome({id: 'o1', projectId: 'p1'}))
    await store.saveOutcome(makeOutcome({id: 'o2', projectId: 'p1'}))
    await store.saveOutcome(makeOutcome({id: 'o3', projectId: 'p2'}))

    const deleted = await store.deleteOutcomes('p1', 'curate')
    expect(deleted).to.equal(2)

    const leftP1 = await store.listOutcomes('p1', 'curate')
    const leftP2 = await store.listOutcomes('p2', 'curate')
    expect(leftP1).to.deep.equal([])
    expect(leftP2.map((o) => o.id)).to.deep.equal(['o3'])
  })

  it('pruneOldVersions keeps the newest `keep` by version number', async () => {
    const store = new InMemoryHarnessStore()
    for (let i = 1; i <= 5; i++) {
      // eslint-disable-next-line no-await-in-loop
      await store.saveVersion(makeVersion({id: `v${i}`, version: i}))
    }

    const deleted = await store.pruneOldVersions('p', 'curate', 2)
    expect(deleted).to.equal(3)

    const remaining = await store.listVersions('p', 'curate')
    expect(remaining.map((v) => v.version)).to.deep.equal([5, 4])
  })

  it('getLatest / getVersion return undefined (not null) on miss', async () => {
    const store = new InMemoryHarnessStore()
    expect(await store.getLatest('p', 'curate')).to.equal(undefined)
    expect(await store.getVersion('p', 'curate', 'v-missing')).to.equal(undefined)
  })

  it('listVersions returns newest first by version number', async () => {
    const store = new InMemoryHarnessStore()
    await store.saveVersion(makeVersion({id: 'v1', version: 1}))
    await store.saveVersion(makeVersion({id: 'v3', version: 3}))
    await store.saveVersion(makeVersion({id: 'v2', version: 2}))

    const list = await store.listVersions('p', 'curate')
    expect(list.map((v) => v.version)).to.deep.equal([3, 2, 1])
  })
})
