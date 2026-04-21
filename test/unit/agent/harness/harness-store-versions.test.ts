import {expect} from 'chai'
import {ZodError} from 'zod'

import type {HarnessVersion} from '../../../../src/agent/core/domain/harness/types.js'

import {
  HarnessStoreError,
  HarnessStoreErrorCode,
} from '../../../../src/agent/core/domain/errors/harness-store-error.js'
import {NoOpLogger} from '../../../../src/agent/core/interfaces/i-logger.js'
import {HarnessStore} from '../../../../src/agent/infra/harness/harness-store.js'
import {FileKeyStorage} from '../../../../src/agent/infra/storage/file-key-storage.js'

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

async function newStore(): Promise<HarnessStore> {
  const keyStorage = new FileKeyStorage({inMemory: true})
  await keyStorage.initialize()
  return new HarnessStore(keyStorage, new NoOpLogger())
}

describe('HarnessStore — version CRUD', () => {
  // ── Round-trip ────────────────────────────────────────────────────────────

  it('saveVersion + getVersion round-trips an entry', async () => {
    const store = await newStore()
    const v = makeVersion({id: 'v1', version: 1})
    await store.saveVersion(v)

    const fetched = await store.getVersion('p', 'curate', 'v1')
    expect(fetched).to.deep.equal(v)
  })

  it('saveVersion + getLatest returns the just-saved entry when it is the only one', async () => {
    const store = await newStore()
    const v = makeVersion({id: 'v1', version: 1})
    await store.saveVersion(v)

    const latest = await store.getLatest('p', 'curate')
    expect(latest).to.deep.equal(v)
  })

  it('getLatest returns the entry with the highest version number among multiple entries', async () => {
    const store = await newStore()
    await store.saveVersion(makeVersion({id: 'v1', version: 1}))
    await store.saveVersion(makeVersion({id: 'v2', version: 2}))
    await store.saveVersion(makeVersion({id: 'v3', version: 3}))

    const latest = await store.getLatest('p', 'curate')
    expect(latest?.version).to.equal(3)
    expect(latest?.id).to.equal('v3')
  })

  it('listVersions returns newest-first on three entries with different version numbers', async () => {
    const store = await newStore()
    await store.saveVersion(makeVersion({id: 'v1', version: 1}))
    await store.saveVersion(makeVersion({id: 'v2', version: 2}))
    await store.saveVersion(makeVersion({id: 'v3', version: 3}))

    const list = await store.listVersions('p', 'curate')
    expect(list.map((v) => v.version)).to.deep.equal([3, 2, 1])
  })

  // ── Conflict detection ────────────────────────────────────────────────────

  it('saveVersion twice with the same id throws VERSION_CONFLICT with details.id', async () => {
    const store = await newStore()
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
    const store = await newStore()
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

  // ── Validation ────────────────────────────────────────────────────────────

  it('saveVersion with malformed input (empty code) throws ZodError', async () => {
    const store = await newStore()
    try {
      await store.saveVersion(makeVersion({code: '', id: 'v1'}))
      expect.fail('expected throw')
    } catch (error) {
      expect(error).to.be.instanceOf(ZodError)
    }
  })

  it('saveVersion with malformed input (heuristic > 1) throws ZodError', async () => {
    const store = await newStore()
    try {
      await store.saveVersion(makeVersion({heuristic: 1.5, id: 'v1'}))
      expect.fail('expected throw')
    } catch (error) {
      expect(error).to.be.instanceOf(ZodError)
    }
  })

  // ── Empty-store semantics ─────────────────────────────────────────────────

  it('getVersion on a missing id returns undefined', async () => {
    const store = await newStore()
    expect(await store.getVersion('p', 'curate', 'does-not-exist')).to.equal(undefined)
  })

  it('getLatest on an empty store returns undefined', async () => {
    const store = await newStore()
    expect(await store.getLatest('p', 'curate')).to.equal(undefined)
  })

  it('listVersions on an empty store returns an empty array', async () => {
    const store = await newStore()
    expect(await store.listVersions('p', 'curate')).to.deep.equal([])
  })

  // ── Pruning ───────────────────────────────────────────────────────────────

  it('pruneOldVersions(..., 2) on 5 versions keeps latest + best-H and returns 3', async () => {
    const store = await newStore()
    // v1..v5 with heuristics: v1=0.1, v2=0.2, v3=0.9 (best), v4=0.4, v5=0.5
    // Latest is v5 (version 5). Best-H is v3.
    // Preserved: {v5, v3}. Candidates oldest-first: [v1, v2, v4]. Delete 3.
    await store.saveVersion(makeVersion({heuristic: 0.1, id: 'v1', version: 1}))
    await store.saveVersion(makeVersion({heuristic: 0.2, id: 'v2', version: 2}))
    await store.saveVersion(makeVersion({heuristic: 0.9, id: 'v3', version: 3}))
    await store.saveVersion(makeVersion({heuristic: 0.4, id: 'v4', version: 4}))
    await store.saveVersion(makeVersion({heuristic: 0.5, id: 'v5', version: 5}))

    const deleted = await store.pruneOldVersions('p', 'curate', 2)
    expect(deleted).to.equal(3)

    const remaining = await store.listVersions('p', 'curate')
    expect(remaining.map((v) => v.id).sort()).to.deep.equal(['v3', 'v5'])
  })

  it('pruneOldVersions preserves the parent chain of the best-H version', async () => {
    const store = await newStore()
    // v1 (root), v2 parent=v1, v3 parent=v2 (best-H, 0.9), v4 (no chain), v5 (latest).
    // Preserved: {v5 (latest), v3 (best-H), v2 (v3's parent), v1 (v2's parent)} = 4 items.
    // keep = 3 → want 3, but preservation demands 4 → preservation wins.
    // Candidates not in preserved: [v4]. Delete 1.
    await store.saveVersion(makeVersion({heuristic: 0.1, id: 'v1', version: 1}))
    await store.saveVersion(makeVersion({heuristic: 0.2, id: 'v2', parentId: 'v1', version: 2}))
    await store.saveVersion(makeVersion({heuristic: 0.9, id: 'v3', parentId: 'v2', version: 3}))
    await store.saveVersion(makeVersion({heuristic: 0.3, id: 'v4', version: 4}))
    await store.saveVersion(makeVersion({heuristic: 0.5, id: 'v5', version: 5}))

    const deleted = await store.pruneOldVersions('p', 'curate', 3)
    expect(deleted).to.equal(1)

    const remaining = await store.listVersions('p', 'curate')
    expect(remaining.map((v) => v.id).sort()).to.deep.equal(['v1', 'v2', 'v3', 'v5'])
  })

  it('pruneOldVersions with keep >= count returns 0', async () => {
    const store = await newStore()
    await store.saveVersion(makeVersion({id: 'v1', version: 1}))
    await store.saveVersion(makeVersion({id: 'v2', version: 2}))

    expect(await store.pruneOldVersions('p', 'curate', 5)).to.equal(0)
    expect(await store.pruneOldVersions('p', 'curate', 2)).to.equal(0)
  })

  it('pruneOldVersions with keep=0 still preserves latest and best-H (preservation wins over keep)', async () => {
    const store = await newStore()
    await store.saveVersion(makeVersion({id: 'v1', version: 1}))

    // Single version is both latest and best-H; preservation set has
    // size 1, which exceeds keep=0. Preservation wins → 0 deletions.
    expect(await store.pruneOldVersions('p', 'curate', 0)).to.equal(0)
    expect(await store.listVersions('p', 'curate')).to.have.lengthOf(1)
  })

  it('pruneOldVersions with negative keep throws RangeError', async () => {
    const store = await newStore()
    await store.saveVersion(makeVersion({id: 'v1', version: 1}))

    try {
      await store.pruneOldVersions('p', 'curate', -1)
      expect.fail('expected throw')
    } catch (error) {
      expect(error).to.be.instanceOf(RangeError)
    }
  })

  it('pruneOldVersions with non-integer keep throws RangeError', async () => {
    const store = await newStore()
    await store.saveVersion(makeVersion({id: 'v1', version: 1}))

    try {
      await store.pruneOldVersions('p', 'curate', 2.5)
      expect.fail('expected throw')
    } catch (error) {
      expect(error).to.be.instanceOf(RangeError)
    }
  })

  // ── Concurrency ───────────────────────────────────────────────────────────

  it('100 parallel saveVersion calls on distinct (id, version) tuples all persist', async () => {
    const store = await newStore()
    const saves = Array.from({length: 100}, (_, i) =>
      store.saveVersion(makeVersion({id: `v${i}`, version: i + 1})),
    )
    await Promise.all(saves)

    const list = await store.listVersions('p', 'curate')
    expect(list).to.have.lengthOf(100)
  })

  it('seeded version + 100 parallels (99 unique, 1 clash on seed id) yields exactly one throw', async () => {
    const store = await newStore()
    // Seed with v-seed so the conflicting call below has something to clash against.
    await store.saveVersion(makeVersion({id: 'v-seed', version: 1000}))

    const attempts = Array.from({length: 100}, (_, i) => {
      if (i === 0) {
        // The one intentional clash — same id as the seed.
        return store.saveVersion(makeVersion({id: 'v-seed', version: 2000}))
      }

      return store.saveVersion(makeVersion({id: `v-${i}`, version: i}))
    })

    const results = await Promise.allSettled(attempts)
    const rejected = results.filter((r) => r.status === 'rejected')
    const fulfilled = results.filter((r) => r.status === 'fulfilled')

    expect(rejected).to.have.lengthOf(1)
    expect(fulfilled).to.have.lengthOf(99)
    expect(
      HarnessStoreError.isCode(
        (rejected[0] as PromiseRejectedResult).reason,
        HarnessStoreErrorCode.VERSION_CONFLICT,
      ),
    ).to.equal(true)

    const list = await store.listVersions('p', 'curate')
    expect(list).to.have.lengthOf(100) // seed + 99 unique
  })
})
