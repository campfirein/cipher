import {expect} from 'chai'
import sinon from 'sinon'

import type {ILogger} from '../../../../src/agent/core/interfaces/i-logger.js'

import {FileKeyStorage} from '../../../../src/agent/infra/storage/file-key-storage.js'
import {
  createDefaultRuntimeSignals,
  DEFAULT_IMPORTANCE,
  type RuntimeSignals,
} from '../../../../src/server/core/domain/knowledge/runtime-signals-schema.js'
import {RuntimeSignalStore} from '../../../../src/server/infra/context-tree/runtime-signal-store.js'

function createMockLogger(): ILogger {
  return {
    debug: sinon.stub(),
    error: sinon.stub(),
    info: sinon.stub(),
    warn: sinon.stub(),
  }
}

async function expectRejected(promise: Promise<unknown>): Promise<void> {
  let threw = false
  try {
    await promise
  } catch {
    threw = true
  }

  expect(threw).to.equal(true)
}

describe('RuntimeSignalStore', () => {
  let keyStorage: FileKeyStorage
  let logger: ILogger
  let store: RuntimeSignalStore

  beforeEach(async () => {
    keyStorage = new FileKeyStorage({inMemory: true})
    await keyStorage.initialize()
    logger = createMockLogger()
    store = new RuntimeSignalStore(keyStorage, logger)
  })

  afterEach(() => {
    keyStorage.close()
  })

  describe('get', () => {
    it('returns defaults for a path with no stored entry', async () => {
      const result = await store.get('auth/jwt.md')
      expect(result).to.deep.equal(createDefaultRuntimeSignals())
    })

    it('returns stored values for a path that was set', async () => {
      await store.set('auth/jwt.md', {
        accessCount: 7,
        importance: 78,
        maturity: 'validated',
        recency: 0.6,
        updateCount: 3,
      })

      expect(await store.get('auth/jwt.md')).to.deep.equal({
        accessCount: 7,
        importance: 78,
        maturity: 'validated',
        recency: 0.6,
        updateCount: 3,
      })
    })

    it('returns defaults and logs a warning when stored data is corrupt', async () => {
      // Seed a corrupt record directly, bypassing the store's set() validation.
      await keyStorage.set(['signals', 'corrupt.md'], {importance: 'not-a-number'})

      expect(await store.get('corrupt.md')).to.deep.equal(createDefaultRuntimeSignals())
      expect((logger.warn as sinon.SinonStub).calledOnce).to.equal(true)
    })

    it('fills missing fields with defaults when a partial record is stored (forward-compat)', async () => {
      // If a future version adds a new field, existing records should still
      // read successfully — the Zod schema's per-field defaults cover the gap.
      await keyStorage.set(['signals', 'partial.md'], {importance: 80})

      expect(await store.get('partial.md')).to.deep.equal({
        ...createDefaultRuntimeSignals(),
        importance: 80,
      })
    })

    it('handles deeply-nested paths', async () => {
      await store.set('a/b/c/d/leaf.md', {...createDefaultRuntimeSignals(), importance: 90})
      expect((await store.get('a/b/c/d/leaf.md')).importance).to.equal(90)
    })
  })

  describe('set', () => {
    it('persists a full record round-trippable via get', async () => {
      const signals: RuntimeSignals = {...createDefaultRuntimeSignals(), importance: 90, maturity: 'core'}
      await store.set('auth/jwt.md', signals)
      expect(await store.get('auth/jwt.md')).to.deep.equal(signals)
    })

    it('overwrites an existing record entirely', async () => {
      await store.set('auth/jwt.md', {...createDefaultRuntimeSignals(), importance: 60})
      await store.set('auth/jwt.md', {...createDefaultRuntimeSignals(), importance: 20})

      expect((await store.get('auth/jwt.md')).importance).to.equal(20)
    })

    it('rejects invalid records at write time', async () => {
      const invalid = {...createDefaultRuntimeSignals(), importance: 150}
      await expectRejected(store.set('auth/jwt.md', invalid))
    })
  })

  describe('update', () => {
    it('seeds defaults when no record exists and applies the updater', async () => {
      const next = await store.update('auth/jwt.md', (current) => ({
        ...current,
        importance: current.importance + 5,
      }))

      expect(next.importance).to.equal(DEFAULT_IMPORTANCE + 5)
      expect(next.accessCount).to.equal(0)
      expect((await store.get('auth/jwt.md')).importance).to.equal(DEFAULT_IMPORTANCE + 5)
    })

    it('reads the stored record and passes it to the updater', async () => {
      await store.set('auth/jwt.md', {
        accessCount: 2,
        importance: 60,
        maturity: 'draft',
        recency: 0.8,
        updateCount: 1,
      })

      await store.update('auth/jwt.md', (current) => ({
        ...current,
        accessCount: current.accessCount + 3,
        importance: current.importance + 10,
      }))

      expect(await store.get('auth/jwt.md')).to.deep.equal({
        accessCount: 5,
        importance: 70,
        maturity: 'draft',
        recency: 0.8,
        updateCount: 1,
      })
    })

    it('rejects updater output that violates the schema', async () => {
      await expectRejected(
        store.update('auth/jwt.md', (current) => ({...current, importance: 150})),
      )
    })

    it('serializes concurrent updates on the same path without losing bumps', async () => {
      // Classic lost-update test: each update reads current and adds 1.
      // With atomic read-modify-write, the final value reflects every iteration.
      const iterations = 20
      await Promise.all(
        Array.from({length: iterations}, () =>
          store.update('hot.md', (current) => ({
            ...current,
            importance: current.importance + 1,
          })),
        ),
      )

      expect((await store.get('hot.md')).importance).to.equal(DEFAULT_IMPORTANCE + iterations)
    })
  })

  describe('batchUpdate', () => {
    it('applies all updaters and persists the results', async () => {
      const updates = new Map([
        ['auth/jwt.md', (c: RuntimeSignals) => ({...c, importance: 70})],
        ['auth/oauth.md', (c: RuntimeSignals) => ({...c, accessCount: 3, importance: 65})],
        ['billing/invoices.md', (c: RuntimeSignals) => ({...c, maturity: 'validated' as const})],
      ])

      await store.batchUpdate(updates)

      expect((await store.get('auth/jwt.md')).importance).to.equal(70)
      const oauth = await store.get('auth/oauth.md')
      expect(oauth.importance).to.equal(65)
      expect(oauth.accessCount).to.equal(3)
      expect((await store.get('billing/invoices.md')).maturity).to.equal('validated')
    })

    it('is a no-op for an empty map', async () => {
      await store.batchUpdate(new Map())
      expect((await store.list()).size).to.equal(0)
    })

    it('serializes concurrent bumps on the same path across batches', async () => {
      // Two overlapping batch flushes target the same file — both must land.
      const batchA = new Map([
        ['shared.md', (c: RuntimeSignals) => ({...c, accessCount: c.accessCount + 5})],
      ])
      const batchB = new Map([
        ['shared.md', (c: RuntimeSignals) => ({...c, accessCount: c.accessCount + 7})],
      ])

      await Promise.all([store.batchUpdate(batchA), store.batchUpdate(batchB)])

      expect((await store.get('shared.md')).accessCount).to.equal(12)
    })
  })

  describe('getMany', () => {
    it('returns a map with an entry for every requested path', async () => {
      await store.set('a.md', {...createDefaultRuntimeSignals(), importance: 91})
      await store.set('b.md', {...createDefaultRuntimeSignals(), importance: 92})

      const result = await store.getMany(['a.md', 'b.md', 'missing.md'])

      expect(result.size).to.equal(3)
      expect(result.get('a.md')?.importance).to.equal(91)
      expect(result.get('b.md')?.importance).to.equal(92)
      expect(result.get('missing.md')).to.deep.equal(createDefaultRuntimeSignals())
    })

    it('returns an empty map for an empty input', async () => {
      expect((await store.getMany([])).size).to.equal(0)
    })

    it('does not read entries outside the requested set', async () => {
      await store.set('wanted.md', {...createDefaultRuntimeSignals(), importance: 77})
      await store.set('ignored.md', {...createDefaultRuntimeSignals(), importance: 42})

      const result = await store.getMany(['wanted.md'])
      expect(result.size).to.equal(1)
      expect(result.has('ignored.md')).to.equal(false)
    })
  })

  describe('path encoding edge cases', () => {
    it('normalizes leading and trailing slashes', async () => {
      await store.set('/leading.md', {...createDefaultRuntimeSignals(), importance: 61})
      // Same logical path, different surface form — should hit the same entry.
      expect((await store.get('leading.md')).importance).to.equal(61)

      await store.set('trailing/', {...createDefaultRuntimeSignals(), importance: 62})
      expect((await store.get('trailing')).importance).to.equal(62)
    })

    it('collapses consecutive slashes', async () => {
      await store.set('a//b.md', {...createDefaultRuntimeSignals(), importance: 63})
      expect((await store.get('a/b.md')).importance).to.equal(63)
    })
  })

  describe('delete', () => {
    it('removes an existing entry so subsequent get returns defaults', async () => {
      await store.set('gone.md', {...createDefaultRuntimeSignals(), importance: 90})
      await store.delete('gone.md')

      expect(await store.get('gone.md')).to.deep.equal(createDefaultRuntimeSignals())
    })

    it('is a no-op for a missing path', async () => {
      await store.delete('never-existed.md')
      expect(await store.get('never-existed.md')).to.deep.equal(createDefaultRuntimeSignals())
    })
  })

  describe('list', () => {
    it('returns an empty map when nothing is stored', async () => {
      expect((await store.list()).size).to.equal(0)
    })

    it('returns all stored entries keyed by relPath', async () => {
      await store.set('a.md', {...createDefaultRuntimeSignals(), importance: 51})
      await store.set('b/nested.md', {...createDefaultRuntimeSignals(), importance: 52})
      await store.set('c/deeper/leaf.md', {...createDefaultRuntimeSignals(), importance: 53})

      const all = await store.list()
      expect(all.size).to.equal(3)
      expect(all.get('a.md')?.importance).to.equal(51)
      expect(all.get('b/nested.md')?.importance).to.equal(52)
      expect(all.get('c/deeper/leaf.md')?.importance).to.equal(53)
    })

    it('falls back to defaults for corrupt entries instead of crashing', async () => {
      await store.set('good.md', createDefaultRuntimeSignals())
      await keyStorage.set(['signals', 'bad.md'], {importance: 'nope'})

      const all = await store.list()
      expect(all.has('good.md')).to.equal(true)
      expect(all.get('bad.md')).to.deep.equal(createDefaultRuntimeSignals())
    })

    it('ignores keys outside the signals namespace', async () => {
      // Another subsystem sharing the same keyStorage must not leak into list().
      await store.set('a.md', createDefaultRuntimeSignals())
      await keyStorage.set(['session', 'some-session-id'], {foo: 'bar'})

      const all = await store.list()
      expect(all.size).to.equal(1)
      expect(all.has('a.md')).to.equal(true)
    })
  })
})
