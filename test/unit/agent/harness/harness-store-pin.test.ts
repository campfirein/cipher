/**
 * HarnessStore pin persistence — Phase 7 Task 7.2 addition.
 *
 * Uses the real HarnessStore against an in-memory FileKeyStorage so
 * the key layout (`harness:pin:<projectId>:<commandType>`) and
 * Zod-validated envelope stay bound to the production path, not a
 * test double.
 */

import {expect} from 'chai'

import type {HarnessPin} from '../../../../src/agent/core/domain/harness/types.js'

import {NoOpLogger} from '../../../../src/agent/core/interfaces/i-logger.js'
import {HarnessStore} from '../../../../src/agent/infra/harness/harness-store.js'
import {FileKeyStorage} from '../../../../src/agent/infra/storage/file-key-storage.js'

async function makeStore(): Promise<HarnessStore> {
  const keyStorage = new FileKeyStorage({inMemory: true})
  await keyStorage.initialize()
  return new HarnessStore(keyStorage, new NoOpLogger())
}

function makePin(overrides: Partial<HarnessPin> = {}): HarnessPin {
  return {
    commandType: 'curate',
    pinnedAt: 1_700_000_000_000,
    pinnedVersionId: 'v-abc',
    projectId: 'fixture-proj',
    ...overrides,
  }
}

describe('HarnessStore pin persistence', () => {
  it('1. getPin returns undefined when no pin has been written', async () => {
    const store = await makeStore()
    const pin = await store.getPin('fixture-proj', 'curate')
    expect(pin).to.equal(undefined)
  })

  it('2. setPin then getPin round-trips the pin record', async () => {
    const store = await makeStore()
    const pin = makePin()
    await store.setPin(pin)
    const got = await store.getPin('fixture-proj', 'curate')
    expect(got).to.deep.equal(pin)
  })

  it('3. setPin is an idempotent overwrite (one pin per pair)', async () => {
    const store = await makeStore()
    await store.setPin(makePin({pinnedVersionId: 'v-old'}))
    await store.setPin(makePin({pinnedVersionId: 'v-new'}))
    const got = await store.getPin('fixture-proj', 'curate')
    expect(got?.pinnedVersionId).to.equal('v-new')
  })

  it('4. pins are partitioned by (projectId, commandType)', async () => {
    const store = await makeStore()
    await store.setPin(makePin({commandType: 'curate', pinnedVersionId: 'v-c'}))
    await store.setPin(makePin({commandType: 'query', pinnedVersionId: 'v-q'}))
    await store.setPin(
      makePin({commandType: 'curate', pinnedVersionId: 'v-other', projectId: 'other-proj'}),
    )

    expect((await store.getPin('fixture-proj', 'curate'))?.pinnedVersionId).to.equal('v-c')
    expect((await store.getPin('fixture-proj', 'query'))?.pinnedVersionId).to.equal('v-q')
    expect((await store.getPin('other-proj', 'curate'))?.pinnedVersionId).to.equal('v-other')
  })
})
