import {expect} from 'chai'

import type {ParsedSSHKey} from '../../../../src/server/infra/ssh/types.js'

import {SigningKeyCache} from '../../../../src/server/infra/ssh/signing-key-cache.js'

// Minimal stub ParsedSSHKey — only needs the shape for caching tests
function makeFakeKey(id: string): ParsedSSHKey {
  return {
    fingerprint: `SHA256:${id}`,
    keyType: 'ssh-ed25519',
    privateKeyObject: {} as never,
    publicKeyBlob: Buffer.from(id),
  }
}

describe('SigningKeyCache', () => {
  describe('get() / set()', () => {
    it('returns null for unknown key path', () => {
      const cache = new SigningKeyCache()
      expect(cache.get('/nonexistent/key')).to.be.null
    })

    it('returns stored key immediately after set()', () => {
      const cache = new SigningKeyCache()
      const key = makeFakeKey('abc')
      cache.set('/home/user/.ssh/id_ed25519', key)
      expect(cache.get('/home/user/.ssh/id_ed25519')).to.equal(key)
    })

    it('different paths are stored independently', () => {
      const cache = new SigningKeyCache()
      const key1 = makeFakeKey('k1')
      const key2 = makeFakeKey('k2')
      cache.set('/path/to/key1', key1)
      cache.set('/path/to/key2', key2)
      expect(cache.get('/path/to/key1')).to.equal(key1)
      expect(cache.get('/path/to/key2')).to.equal(key2)
    })

    it('overwriting a key replaces it', () => {
      const cache = new SigningKeyCache()
      const key1 = makeFakeKey('v1')
      const key2 = makeFakeKey('v2')
      cache.set('/same/path', key1)
      cache.set('/same/path', key2)
      expect(cache.get('/same/path')).to.equal(key2)
    })
  })

  describe('size', () => {
    it('is 0 for empty cache', () => {
      const cache = new SigningKeyCache()
      expect(cache.size).to.equal(0)
    })

    it('counts non-expired entries', () => {
      const cache = new SigningKeyCache()
      cache.set('/a', makeFakeKey('a'))
      cache.set('/b', makeFakeKey('b'))
      expect(cache.size).to.equal(2)
    })
  })

  describe('TTL expiry', () => {
    it('returns null after TTL expires', async function () {
      this.timeout(3000)

      // Create cache with 50ms TTL for fast test
      const cache = new SigningKeyCache(50)
      const key = makeFakeKey('ttl-test')
      cache.set('/ttl/test', key)

      // Still accessible immediately
      expect(cache.get('/ttl/test')).to.equal(key)

      // Wait for TTL to expire
      await new Promise<void>((resolve) => { setTimeout(resolve, 100) })

      expect(cache.get('/ttl/test')).to.be.null
    })

    it('returns key before TTL expires', async function () {
      this.timeout(3000)

      const cache = new SigningKeyCache(500)
      const key = makeFakeKey('ttl-alive')
      cache.set('/ttl/alive', key)

      await new Promise<void>((resolve) => { setTimeout(resolve, 50) })

      expect(cache.get('/ttl/alive')).to.equal(key)
    })
  })

  describe('expired entry cleanup on set()', () => {
    it('removes expired entries when a new key is set', async function () {
      this.timeout(3000)

      const cache = new SigningKeyCache(50)
      cache.set('/old', makeFakeKey('old'))

      // Wait for TTL to expire
      await new Promise<void>((resolve) => { setTimeout(resolve, 100) })

      // Set a new key — should sweep the expired '/old' entry
      cache.set('/new', makeFakeKey('new'))

      // The expired entry should have been cleaned up from internal storage
      // size only counts non-expired, so it should be 1
      expect(cache.size).to.equal(1)
      expect(cache.get('/old')).to.be.null
      expect(cache.get('/new')).to.not.be.null
    })
  })

  describe('invalidate()', () => {
    it('removes a specific key path from cache', () => {
      const cache = new SigningKeyCache()
      const key = makeFakeKey('to-clear')
      cache.set('/invalidate/me', key)
      cache.invalidate('/invalidate/me')
      expect(cache.get('/invalidate/me')).to.be.null
    })

    it('does not affect other cached keys when invalidating one', () => {
      const cache = new SigningKeyCache()
      const key1 = makeFakeKey('keep')
      const key2 = makeFakeKey('remove')
      cache.set('/keep', key1)
      cache.set('/remove', key2)
      cache.invalidate('/remove')
      expect(cache.get('/keep')).to.equal(key1)
      expect(cache.get('/remove')).to.be.null
    })
  })

  describe('invalidateAll()', () => {
    it('clears all entries', () => {
      const cache = new SigningKeyCache()
      cache.set('/a', makeFakeKey('a'))
      cache.set('/b', makeFakeKey('b'))
      cache.set('/c', makeFakeKey('c'))
      cache.invalidateAll()
      expect(cache.size).to.equal(0)
      expect(cache.get('/a')).to.be.null
      expect(cache.get('/b')).to.be.null
    })
  })
})
