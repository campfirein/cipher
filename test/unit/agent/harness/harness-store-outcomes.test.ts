import {expect} from 'chai'

import type {
  CodeExecOutcome,
  EvaluationScenario,
} from '../../../../src/agent/core/domain/harness/types.js'

import {
  HarnessStoreError,
  HarnessStoreErrorCode,
} from '../../../../src/agent/core/domain/errors/harness-store-error.js'
import {NoOpLogger} from '../../../../src/agent/core/interfaces/i-logger.js'
import {HarnessStore} from '../../../../src/agent/infra/harness/harness-store.js'
import {FileKeyStorage} from '../../../../src/agent/infra/storage/file-key-storage.js'

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
    expectedBehavior: 'returns results',
    id: 's-default',
    projectId: 'p',
    projectType: 'typescript',
    taskDescription: 'find auth module',
    ...overrides,
  }
}

async function newStore(): Promise<HarnessStore> {
  const keyStorage = new FileKeyStorage({inMemory: true})
  await keyStorage.initialize()
  return new HarnessStore(keyStorage, new NoOpLogger())
}

describe('HarnessStore — outcome + scenario CRUD', () => {
  // ── Outcome round-trip ────────────────────────────────────────────────────

  it('saveOutcome + listOutcomes returns the entry', async () => {
    const store = await newStore()
    const o = makeOutcome({id: 'o1'})
    await store.saveOutcome(o)

    const list = await store.listOutcomes('p', 'curate')
    expect(list).to.have.lengthOf(1)
    expect(list[0].id).to.equal('o1')
  })

  it('listOutcomes newest-first with limit caps to the N newest', async () => {
    const store = await newStore()
    for (let i = 0; i < 5; i++) {
      // eslint-disable-next-line no-await-in-loop
      await store.saveOutcome(makeOutcome({id: `o${i}`, timestamp: 1000 + i}))
    }

    const top2 = await store.listOutcomes('p', 'curate', 2)
    expect(top2.map((o) => o.id)).to.deep.equal(['o4', 'o3'])
  })

  it('listOutcomes default limit is 100 when more outcomes exist', async () => {
    const store = await newStore()
    const saves = Array.from({length: 150}, (_, i) =>
      store.saveOutcome(makeOutcome({id: `o${i}`, timestamp: 1000 + i})),
    )
    await Promise.all(saves)

    const defaulted = await store.listOutcomes('p', 'curate')
    expect(defaulted).to.have.lengthOf(100)
  })

  it('saveOutcome with duplicate id overwrites (no throw, idempotent)', async () => {
    const store = await newStore()
    await store.saveOutcome(makeOutcome({id: 'o1', success: true}))
    await store.saveOutcome(makeOutcome({id: 'o1', success: false}))

    const list = await store.listOutcomes('p', 'curate')
    expect(list).to.have.lengthOf(1)
    expect(list[0].success).to.equal(false)
  })

  // ── Outcome deletion ─────────────────────────────────────────────────────

  it('deleteOutcomes on an empty partition returns 0', async () => {
    const store = await newStore()
    expect(await store.deleteOutcomes('p', 'curate')).to.equal(0)
  })

  it('deleteOutcomes clears every outcome under the pair and returns the count', async () => {
    const store = await newStore()
    await store.saveOutcome(makeOutcome({id: 'o1'}))
    await store.saveOutcome(makeOutcome({id: 'o2'}))
    await store.saveOutcome(makeOutcome({id: 'o3'}))

    expect(await store.deleteOutcomes('p', 'curate')).to.equal(3)
    expect(await store.listOutcomes('p', 'curate')).to.have.lengthOf(0)
  })

  it('deleteOutcomes leaves outcomes under other (projectId, commandType) pairs intact', async () => {
    const store = await newStore()
    await store.saveOutcome(makeOutcome({id: 'o1', projectId: 'p1'}))
    await store.saveOutcome(makeOutcome({id: 'o2', projectId: 'p1'}))
    await store.saveOutcome(makeOutcome({id: 'o3', projectId: 'p2'}))

    const deleted = await store.deleteOutcomes('p1', 'curate')
    expect(deleted).to.equal(2)

    expect(await store.listOutcomes('p1', 'curate')).to.have.lengthOf(0)
    expect(await store.listOutcomes('p2', 'curate')).to.have.lengthOf(1)
  })

  // ── Feedback ─────────────────────────────────────────────────────────────

  it('recordFeedback sets userFeedback on the named outcome', async () => {
    const store = await newStore()
    await store.saveOutcome(makeOutcome({id: 'o1'}))

    await store.recordFeedback('p', 'curate', 'o1', 'bad')
    const [after] = await store.listOutcomes('p', 'curate')
    expect(after.userFeedback).to.equal('bad')
  })

  it('recordFeedback with null clears a prior flag', async () => {
    const store = await newStore()
    await store.saveOutcome(makeOutcome({id: 'o1', userFeedback: 'good'}))

    await store.recordFeedback('p', 'curate', 'o1', null)
    const [after] = await store.listOutcomes('p', 'curate')
    expect(after.userFeedback).to.equal(null)
  })

  it('recordFeedback on a nonexistent outcome throws OUTCOME_NOT_FOUND', async () => {
    const store = await newStore()
    try {
      await store.recordFeedback('p', 'curate', 'does-not-exist', 'bad')
      expect.fail('expected throw')
    } catch (error) {
      expect(HarnessStoreError.isCode(error, HarnessStoreErrorCode.OUTCOME_NOT_FOUND)).to.equal(
        true,
      )
      if (!HarnessStoreError.isHarnessStoreError(error)) expect.fail('not a HarnessStoreError')
      expect(error.details?.outcomeId).to.equal('does-not-exist')
    }
  })

  // ── Scenario round-trip ──────────────────────────────────────────────────

  it('saveScenario + listScenarios round-trips', async () => {
    const store = await newStore()
    const s = makeScenario({id: 's1'})
    await store.saveScenario(s)

    const list = await store.listScenarios('p', 'curate')
    expect(list).to.deep.equal([s])
  })

  it('listScenarios on an empty partition returns an empty array', async () => {
    const store = await newStore()
    expect(await store.listScenarios('p', 'curate')).to.deep.equal([])
  })

  it('saveScenario with duplicate id overwrites', async () => {
    const store = await newStore()
    await store.saveScenario(makeScenario({id: 's1', taskDescription: 'original'}))
    await store.saveScenario(makeScenario({id: 's1', taskDescription: 'replaced'}))

    const list = await store.listScenarios('p', 'curate')
    expect(list).to.have.lengthOf(1)
    expect(list[0].taskDescription).to.equal('replaced')
  })

  // ── Cross-projectType partition ──────────────────────────────────────────

  it('listOutcomes merges entries across projectType partitions under the same (projectId, commandType)', async () => {
    const store = await newStore()
    await store.saveOutcome(makeOutcome({id: 'ts1', projectType: 'typescript', timestamp: 1000}))
    await store.saveOutcome(makeOutcome({id: 'ts2', projectType: 'typescript', timestamp: 2000}))
    await store.saveOutcome(makeOutcome({id: 'ts3', projectType: 'typescript', timestamp: 3000}))
    await store.saveOutcome(makeOutcome({id: 'py1', projectType: 'python', timestamp: 4000}))
    await store.saveOutcome(makeOutcome({id: 'py2', projectType: 'python', timestamp: 5000}))

    const list = await store.listOutcomes('p', 'curate')
    expect(list).to.have.lengthOf(5)
    expect(list.map((o) => o.id)).to.deep.equal(['py2', 'py1', 'ts3', 'ts2', 'ts1'])
  })

  it('listScenarios merges entries across projectType partitions', async () => {
    const store = await newStore()
    await store.saveScenario(makeScenario({id: 'ts1', projectType: 'typescript'}))
    await store.saveScenario(makeScenario({id: 'py1', projectType: 'python'}))
    await store.saveScenario(makeScenario({id: 'gn1', projectType: 'generic'}))

    const list = await store.listScenarios('p', 'curate')
    expect(list).to.have.lengthOf(3)
    expect(list.map((s) => s.id).sort()).to.deep.equal(['gn1', 'py1', 'ts1'])
  })

  // ── Concurrency ──────────────────────────────────────────────────────────

  it('100 parallel saveOutcome calls on distinct ids all persist', async () => {
    const store = await newStore()
    const saves = Array.from({length: 100}, (_, i) =>
      store.saveOutcome(makeOutcome({id: `o${i}`, timestamp: 1000 + i})),
    )
    await Promise.all(saves)

    const list = await store.listOutcomes('p', 'curate', 200)
    expect(list).to.have.lengthOf(100)
  })

  it('50 seeded outcomes + 50 parallel recordFeedback calls all set the field correctly', async () => {
    const store = await newStore()
    // Seed first so the feedback calls can't race ahead of the saves.
    const seeds = Array.from({length: 50}, (_, i) =>
      store.saveOutcome(makeOutcome({id: `o${i}`, timestamp: 1000 + i})),
    )
    await Promise.all(seeds)

    const feedbacks = Array.from({length: 50}, (_, i) =>
      store.recordFeedback('p', 'curate', `o${i}`, 'bad'),
    )
    await Promise.all(feedbacks)

    const list = await store.listOutcomes('p', 'curate', 100)
    expect(list).to.have.lengthOf(50)
    for (const outcome of list) {
      expect(outcome.userFeedback).to.equal('bad')
    }
  })
})
