import {expect} from 'chai'

import type {CodeExecOutcome} from '../../../../src/agent/core/domain/harness/types.js'

import {NoOpLogger} from '../../../../src/agent/core/interfaces/i-logger.js'
import {HarnessStore} from '../../../../src/agent/infra/harness/harness-store.js'
import {FileKeyStorage} from '../../../../src/agent/infra/storage/file-key-storage.js'
import {
  attachFeedbackToStore,
  FeedbackError,
} from '../../../../src/oclif/lib/harness-feedback.js'

const PROJECT_ID = 'fixture-proj'
const SESSION_ID = 's-1'

const ENABLED_FEATURE = {autoLearn: true, enabled: true} as const

async function makeStore(): Promise<HarnessStore> {
  const keyStorage = new FileKeyStorage({inMemory: true})
  await keyStorage.initialize()
  return new HarnessStore(keyStorage, new NoOpLogger())
}

function makeOutcome(overrides: Partial<CodeExecOutcome> = {}): CodeExecOutcome {
  return {
    code: 'ctx.tools.curate([])',
    commandType: 'curate',
    executionTimeMs: 12,
    id: 'o-real',
    projectId: PROJECT_ID,
    projectType: 'typescript',
    sessionId: SESSION_ID,
    success: true,
    timestamp: 1_700_000_000_000,
    usedHarness: false,
    ...overrides,
  }
}

describe('attachFeedbackToStore', () => {
  it('1. "bad" verdict inserts 3 synthetic failure rows', async () => {
    const store = await makeStore()
    await store.saveOutcome(makeOutcome({id: 'o-target'}))

    const result = await attachFeedbackToStore(store, PROJECT_ID, 'curate', 'bad', ENABLED_FEATURE)

    expect(result.outcomeId).to.equal('o-target')
    expect(result.syntheticCount).to.equal(3)
    expect(result.verdict).to.equal('bad')

    const all = await store.listOutcomes(PROJECT_ID, 'curate', 20)
    const synthetics = all.filter((o) => o.id.startsWith('o-target__synthetic_bad_'))
    expect(synthetics.length).to.equal(3)
    for (const s of synthetics) {
      expect(s.success).to.equal(false)
      expect(s.userFeedback).to.equal('bad')
    }
  })

  it('2. "good" verdict inserts 1 synthetic success row', async () => {
    const store = await makeStore()
    await store.saveOutcome(makeOutcome({id: 'o-target'}))

    const result = await attachFeedbackToStore(store, PROJECT_ID, 'curate', 'good', ENABLED_FEATURE)

    expect(result.syntheticCount).to.equal(1)

    const all = await store.listOutcomes(PROJECT_ID, 'curate', 20)
    const synthetics = all.filter((o) => o.id.startsWith('o-target__synthetic_good_'))
    expect(synthetics.length).to.equal(1)
    expect(synthetics[0].success).to.equal(true)
    expect(synthetics[0].userFeedback).to.equal('good')
  })

  it('3. repeat with different verdict replaces the previous synthetics', async () => {
    const store = await makeStore()
    await store.saveOutcome(makeOutcome({id: 'o-target'}))

    await attachFeedbackToStore(store, PROJECT_ID, 'curate', 'good', ENABLED_FEATURE)
    const afterGood = await store.listOutcomes(PROJECT_ID, 'curate', 20)
    expect(afterGood.filter((o) => o.id.startsWith('o-target__synthetic_good_')).length).to.equal(1)

    await attachFeedbackToStore(store, PROJECT_ID, 'curate', 'bad', ENABLED_FEATURE)
    const afterBad = await store.listOutcomes(PROJECT_ID, 'curate', 20)

    // Good synthetics cleared; bad synthetics inserted.
    expect(afterBad.filter((o) => o.id.startsWith('o-target__synthetic_good_')).length).to.equal(0)
    expect(afterBad.filter((o) => o.id.startsWith('o-target__synthetic_bad_')).length).to.equal(3)
    // Original outcome's userFeedback field is now 'bad'.
    const updated = afterBad.find((o) => o.id === 'o-target')
    expect(updated?.userFeedback).to.equal('bad')
  })

  it('4. no recent outcome → throws FeedbackError with code NO_RECENT_OUTCOME', async () => {
    const store = await makeStore()

    let caught: unknown
    try {
      await attachFeedbackToStore(store, PROJECT_ID, 'curate', 'bad', ENABLED_FEATURE)
    } catch (error) {
      caught = error
    }

    expect(caught).to.be.instanceOf(FeedbackError)
    expect((caught as FeedbackError).code).to.equal('NO_RECENT_OUTCOME')
    expect((caught as FeedbackError).details.commandType).to.equal('curate')
  })

  it('5. most-recent-by-timestamp wins when multiple outcomes exist', async () => {
    const store = await makeStore()
    await store.saveOutcome(makeOutcome({id: 'o-older', timestamp: 1000}))
    await store.saveOutcome(makeOutcome({id: 'o-newer', timestamp: 2000}))

    const result = await attachFeedbackToStore(store, PROJECT_ID, 'curate', 'bad', ENABLED_FEATURE)

    expect(result.outcomeId).to.equal('o-newer')
  })

  it('6. commandType partitioning: curate feedback does not touch query outcomes', async () => {
    const store = await makeStore()
    // One outcome per commandType, same project.
    await store.saveOutcome(makeOutcome({commandType: 'curate', id: 'o-curate'}))
    await store.saveOutcome(
      makeOutcome({commandType: 'query', id: 'o-query', timestamp: 1000}),
    )

    await attachFeedbackToStore(store, PROJECT_ID, 'curate', 'bad', ENABLED_FEATURE)

    const curateSide = await store.listOutcomes(PROJECT_ID, 'curate', 20)
    const querySide = await store.listOutcomes(PROJECT_ID, 'query', 20)

    // Curate got 3 synthetic failures; query is untouched.
    expect(curateSide.filter((o) => o.id.startsWith('o-curate__synthetic_bad_')).length).to.equal(3)
    expect(querySide.length).to.equal(1)
    expect(querySide[0].userFeedback).to.equal(undefined)
  })
})
