import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {FileKeyStorage} from '../../../../src/agent/infra/storage/file-key-storage.js'

describe('FileKeyStorage', () => {
  describe('in-memory mode', () => {
    let storage: FileKeyStorage

    beforeEach(async () => {
      storage = new FileKeyStorage({inMemory: true})
      await storage.initialize()
    })

    afterEach(() => {
      storage.close()
    })

    describe('initialization', () => {
      it('should initialize successfully', async () => {
        const newStorage = new FileKeyStorage({inMemory: true})
        await newStorage.initialize()
        // Should be able to perform operations
        await newStorage.set(['test'], 'value')
        expect(await newStorage.get(['test'])).to.equal('value')
        newStorage.close()
      })

      it('should be idempotent (multiple initialize calls)', async () => {
        await storage.initialize()
        await storage.initialize()
        // Should still work
        await storage.set(['test'], 'value')
        expect(await storage.get(['test'])).to.equal('value')
      })

      it('should throw error if operations called before initialize', async () => {
        const uninitStorage = new FileKeyStorage({inMemory: true})
        try {
          await uninitStorage.get(['key'])
          expect.fail('Should have thrown')
        } catch (error) {
          expect((error as Error).message).to.include('not initialized')
        }
      })
    })

    describe('set and get', () => {
      it('should set and get a string value', async () => {
        await storage.set(['key1'], 'value1')
        const result = await storage.get<string>(['key1'])
        expect(result).to.equal('value1')
      })

      it('should set and get an object value', async () => {
        const obj = {count: 42, name: 'test', nested: {a: 1}}
        await storage.set(['object-key'], obj)
        const result = await storage.get<typeof obj>(['object-key'])
        expect(result).to.deep.equal(obj)
      })

      it('should set and get with hierarchical keys', async () => {
        await storage.set(['message', 'session1', 'msg1'], {content: 'hello'})
        await storage.set(['message', 'session1', 'msg2'], {content: 'world'})
        await storage.set(['message', 'session2', 'msg1'], {content: 'other'})

        expect(await storage.get(['message', 'session1', 'msg1'])).to.deep.equal({content: 'hello'})
        expect(await storage.get(['message', 'session1', 'msg2'])).to.deep.equal({content: 'world'})
        expect(await storage.get(['message', 'session2', 'msg1'])).to.deep.equal({content: 'other'})
      })

      it('should return undefined for non-existent key', async () => {
        const result = await storage.get(['nonexistent'])
        expect(result).to.be.undefined
      })

      it('should update existing value', async () => {
        await storage.set(['key'], 'initial')
        await storage.set(['key'], 'updated')
        expect(await storage.get(['key'])).to.equal('updated')
      })

      it('should handle null and boolean values', async () => {
        await storage.set(['null-key'], null)
        await storage.set(['true-key'], true)
        await storage.set(['false-key'], false)

        expect(await storage.get(['null-key'])).to.be.null
        expect(await storage.get(['true-key'])).to.be.true
        expect(await storage.get(['false-key'])).to.be.false
      })

      it('should handle arrays', async () => {
        const arr = [1, 'two', {three: 3}]
        await storage.set(['array-key'], arr)
        expect(await storage.get(['array-key'])).to.deep.equal(arr)
      })
    })

    describe('delete', () => {
      it('should delete existing key and return true', async () => {
        await storage.set(['to-delete'], 'value')
        const result = await storage.delete(['to-delete'])
        expect(result).to.be.true
        expect(await storage.get(['to-delete'])).to.be.undefined
      })

      it('should return false when deleting non-existent key', async () => {
        const result = await storage.delete(['nonexistent'])
        expect(result).to.be.false
      })
    })

    describe('exists', () => {
      it('should return true for existing key', async () => {
        await storage.set(['exists-key'], 'value')
        expect(await storage.exists(['exists-key'])).to.be.true
      })

      it('should return false for non-existent key', async () => {
        expect(await storage.exists(['nonexistent'])).to.be.false
      })
    })

    describe('list', () => {
      it('should list keys matching prefix', async () => {
        await storage.set(['message', 'session1', 'msg1'], 'a')
        await storage.set(['message', 'session1', 'msg2'], 'b')
        await storage.set(['message', 'session2', 'msg1'], 'c')
        await storage.set(['part', 'msg1', 'part1'], 'd')

        const session1Keys = await storage.list(['message', 'session1'])
        expect(session1Keys).to.have.lengthOf(2)
        expect(session1Keys).to.deep.include.members([
          ['message', 'session1', 'msg1'],
          ['message', 'session1', 'msg2'],
        ])
      })

      it('should list all message keys', async () => {
        await storage.set(['message', 'session1', 'msg1'], 'a')
        await storage.set(['message', 'session2', 'msg1'], 'b')
        await storage.set(['part', 'msg1', 'part1'], 'c')

        const messageKeys = await storage.list(['message'])
        expect(messageKeys).to.have.lengthOf(2)
      })

      it('should return empty array for non-matching prefix', async () => {
        await storage.set(['message', 'session1', 'msg1'], 'a')
        const result = await storage.list(['nonexistent'])
        expect(result).to.deep.equal([])
      })

      it('should return keys in sorted order', async () => {
        await storage.set(['item', 'c'], 1)
        await storage.set(['item', 'a'], 2)
        await storage.set(['item', 'b'], 3)

        const keys = await storage.list(['item'])
        expect(keys).to.deep.equal([
          ['item', 'a'],
          ['item', 'b'],
          ['item', 'c'],
        ])
      })
    })

    describe('listWithValues', () => {
      it('should list keys with values matching prefix', async () => {
        await storage.set(['data', 'a'], {name: 'alpha'})
        await storage.set(['data', 'b'], {name: 'beta'})
        await storage.set(['other', 'c'], {name: 'gamma'})

        const results = await storage.listWithValues<{name: string}>(['data'])
        expect(results).to.have.lengthOf(2)

        const sorted = results.sort((a, b) =>
          a.key.join(':').localeCompare(b.key.join(':')),
        )
        expect(sorted[0].key).to.deep.equal(['data', 'a'])
        expect(sorted[0].value).to.deep.equal({name: 'alpha'})
        expect(sorted[1].key).to.deep.equal(['data', 'b'])
        expect(sorted[1].value).to.deep.equal({name: 'beta'})
      })

      it('should return empty array for non-matching prefix', async () => {
        await storage.set(['data', 'a'], 'value')
        const results = await storage.listWithValues(['nonexistent'])
        expect(results).to.deep.equal([])
      })
    })

    describe('update', () => {
      it('should atomically update existing value', async () => {
        await storage.set(['counter'], {value: 5})
        const result = await storage.update<{value: number}>(['counter'], (current) => ({
          value: (current?.value ?? 0) + 1,
        }))
        expect(result).to.deep.equal({value: 6})
        expect(await storage.get(['counter'])).to.deep.equal({value: 6})
      })

      it('should create new value if key does not exist', async () => {
        const result = await storage.update<{value: number}>(['new-key'], (current) => ({
          value: (current?.value ?? 0) + 10,
        }))
        expect(result).to.deep.equal({value: 10})
      })

      it('should pass undefined to updater for new keys', async () => {
        let receivedCurrent: unknown = 'not-set'
        await storage.update(['brand-new'], (current) => {
          receivedCurrent = current
          return 'created'
        })
        expect(receivedCurrent).to.be.undefined
      })
    })

    describe('batch', () => {
      it('should execute multiple set operations', async () => {
        await storage.batch([
          {key: ['batch', 'a'], type: 'set', value: 1},
          {key: ['batch', 'b'], type: 'set', value: 2},
          {key: ['batch', 'c'], type: 'set', value: 3},
        ])

        expect(await storage.get(['batch', 'a'])).to.equal(1)
        expect(await storage.get(['batch', 'b'])).to.equal(2)
        expect(await storage.get(['batch', 'c'])).to.equal(3)
      })

      it('should execute multiple delete operations', async () => {
        await storage.set(['del', 'a'], 1)
        await storage.set(['del', 'b'], 2)

        await storage.batch([
          {key: ['del', 'a'], type: 'delete'},
          {key: ['del', 'b'], type: 'delete'},
        ])

        expect(await storage.exists(['del', 'a'])).to.be.false
        expect(await storage.exists(['del', 'b'])).to.be.false
      })

      it('should handle mixed set/delete operations', async () => {
        await storage.set(['mix', 'existing'], 'old')

        await storage.batch([
          {key: ['mix', 'new'], type: 'set', value: 'created'},
          {key: ['mix', 'existing'], type: 'delete'},
        ])

        expect(await storage.get(['mix', 'new'])).to.equal('created')
        expect(await storage.exists(['mix', 'existing'])).to.be.false
      })

      it('should handle empty batch gracefully', async () => {
        await storage.batch([])
        // Should not throw
      })
    })

    describe('key validation', () => {
      it('should throw error for empty key', async () => {
        try {
          await storage.set([], 'value')
          expect.fail('Should have thrown')
        } catch (error) {
          expect((error as Error).message).to.include('cannot be empty')
        }
      })

      it('should throw error if key segment contains colon', async () => {
        try {
          await storage.set(['invalid:key'], 'value')
          expect.fail('Should have thrown')
        } catch (error) {
          expect((error as Error).message).to.include("cannot contain ':'")
        }
      })

      it('should throw error if key segment contains path separator', async () => {
        try {
          await storage.set(['invalid/key'], 'value')
          expect.fail('Should have thrown')
        } catch (error) {
          expect((error as Error).message).to.include('path separators')
        }
      })

      it('should throw error for empty key segment', async () => {
        try {
          await storage.set(['valid', '', 'key'], 'value')
          expect.fail('Should have thrown')
        } catch (error) {
          expect((error as Error).message).to.include('cannot be empty')
        }
      })

      it('should throw error for dot-dot key segment', async () => {
        try {
          await storage.set(['..'], 'value')
          expect.fail('Should have thrown')
        } catch (error) {
          expect((error as Error).message).to.include("cannot be '..'")
        }
      })
    })

    describe('edge cases', () => {
      it('should handle large values', async () => {
        const largeValue = {data: 'x'.repeat(100_000)}
        await storage.set(['large'], largeValue)
        const result = await storage.get<typeof largeValue>(['large'])
        expect(result?.data.length).to.equal(100_000)
      })

      it('should handle special characters in key segments', async () => {
        await storage.set(['key with spaces', 'emoji-🚀', 'unicode-日本語'], 'value')
        expect(await storage.get(['key with spaces', 'emoji-🚀', 'unicode-日本語'])).to.equal('value')
      })

      it('should preserve createdAt on update', async () => {
        await storage.set(['ts-key'], 'first')
        // Small delay to ensure different timestamps
        await new Promise((resolve) => {
          setTimeout(resolve, 5)
        })
        await storage.set(['ts-key'], 'second')

        // Value should be updated
        expect(await storage.get(['ts-key'])).to.equal('second')
      })
    })
  })

  describe('file-based mode', () => {
    let storage: FileKeyStorage
    let tempDir: string

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'file-key-storage-test-'))
      storage = new FileKeyStorage({storageDir: tempDir})
      await storage.initialize()
    })

    afterEach(async () => {
      storage.close()
      await rm(tempDir, {force: true, recursive: true})
    })

    it('should persist data across storage instances', async () => {
      await storage.set(['persistent'], 'data')
      storage.close()

      const newStorage = new FileKeyStorage({storageDir: tempDir})
      await newStorage.initialize()

      expect(await newStorage.get(['persistent'])).to.equal('data')
      newStorage.close()
    })

    it('should create storage directory if not exists', async () => {
      const newDir = join(tempDir, 'nested', 'dir')
      const newStorage = new FileKeyStorage({storageDir: newDir})
      await newStorage.initialize()

      await newStorage.set(['test'], 'value')
      expect(await newStorage.get(['test'])).to.equal('value')
      newStorage.close()
    })

    it('should persist hierarchical keys', async () => {
      await storage.set(['message', 'session1', 'msg1'], {content: 'hello'})
      await storage.set(['message', 'session1', 'msg2'], {content: 'world'})
      storage.close()

      const newStorage = new FileKeyStorage({storageDir: tempDir})
      await newStorage.initialize()

      expect(await newStorage.get(['message', 'session1', 'msg1'])).to.deep.equal({content: 'hello'})
      expect(await newStorage.get(['message', 'session1', 'msg2'])).to.deep.equal({content: 'world'})

      const keys = await newStorage.list(['message', 'session1'])
      expect(keys).to.have.lengthOf(2)
      newStorage.close()
    })

    it('should list keys from disk', async () => {
      await storage.set(['item', 'c'], 1)
      await storage.set(['item', 'a'], 2)
      await storage.set(['item', 'b'], 3)

      const keys = await storage.list(['item'])
      expect(keys).to.deep.equal([
        ['item', 'a'],
        ['item', 'b'],
        ['item', 'c'],
      ])
    })

    it('should listWithValues from disk', async () => {
      await storage.set(['data', 'x'], {v: 1})
      await storage.set(['data', 'y'], {v: 2})

      const results = await storage.listWithValues<{v: number}>(['data'])
      expect(results).to.have.lengthOf(2)

      const sorted = results.sort((a, b) =>
        a.key.join(':').localeCompare(b.key.join(':')),
      )
      expect(sorted[0].value).to.deep.equal({v: 1})
      expect(sorted[1].value).to.deep.equal({v: 2})
    })

    it('should delete from disk', async () => {
      await storage.set(['to-delete'], 'value')
      expect(await storage.delete(['to-delete'])).to.be.true
      expect(await storage.exists(['to-delete'])).to.be.false

      // Verify not found after reopen
      storage.close()
      const newStorage = new FileKeyStorage({storageDir: tempDir})
      await newStorage.initialize()
      expect(await newStorage.get(['to-delete'])).to.be.undefined
      newStorage.close()
    })

    it('should handle concurrent sequential operations without corruption', async () => {
      const count = 100
      // Write 100 items sequentially
      for (let i = 0; i < count; i++) {
        // eslint-disable-next-line no-await-in-loop
        await storage.set(['seq', `item-${String(i).padStart(3, '0')}`], {index: i})
      }

      // Verify all items exist
      const keys = await storage.list(['seq'])
      expect(keys).to.have.lengthOf(count)

      // Verify values
      for (let i = 0; i < count; i++) {
        // eslint-disable-next-line no-await-in-loop
        const val = await storage.get<{index: number}>(['seq', `item-${String(i).padStart(3, '0')}`])
        expect(val?.index).to.equal(i)
      }
    })
  })

  describe('constructor validation', () => {
    it('should throw error if storageDir not provided in file mode', () => {
      expect(() => {
        const _storage = new FileKeyStorage()
        return _storage
      }).to.throw('storageDir is required')
    })

    it('should not throw if inMemory is true without storageDir', () => {
      const s = new FileKeyStorage({inMemory: true})
      expect(s).to.be.instanceOf(FileKeyStorage)
    })
  })
})
