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

const P1 = '/projects/alpha'
const P2 = '/projects/beta'

describe('SigningKeyCache', () => {
  describe('get() / set()', () => {
    it('returns null for unknown key path', () => {
      const cache = new SigningKeyCache()
      expect(cache.get(P1, '/nonexistent/key')).to.be.undefined
    })

    it('returns stored key immediately after set()', () => {
      const cache = new SigningKeyCache()
      const key = makeFakeKey('abc')
      cache.set(P1, '/home/user/.ssh/id_ed25519', key)
      expect(cache.get(P1, '/home/user/.ssh/id_ed25519')).to.equal(key)
    })

    it('different paths within the same project are stored independently', () => {
      const cache = new SigningKeyCache()
      const key1 = makeFakeKey('k1')
      const key2 = makeFakeKey('k2')
      cache.set(P1, '/path/to/key1', key1)
      cache.set(P1, '/path/to/key2', key2)
      expect(cache.get(P1, '/path/to/key1')).to.equal(key1)
      expect(cache.get(P1, '/path/to/key2')).to.equal(key2)
    })

    it('overwriting a (project, key) pair replaces the entry', () => {
      const cache = new SigningKeyCache()
      const key1 = makeFakeKey('v1')
      const key2 = makeFakeKey('v2')
      cache.set(P1, '/same/path', key1)
      cache.set(P1, '/same/path', key2)
      expect(cache.get(P1, '/same/path')).to.equal(key2)
    })
  })

  describe('project isolation (ENG-2002 M2)', () => {
    it('same keyPath across two projects does NOT share cached entries', () => {
      const cache = new SigningKeyCache()
      const keyInAlpha = makeFakeKey('alpha')
      const keyInBeta = makeFakeKey('beta')
      cache.set(P1, '/home/user/.ssh/id_ed25519', keyInAlpha)
      cache.set(P2, '/home/user/.ssh/id_ed25519', keyInBeta)

      expect(cache.get(P1, '/home/user/.ssh/id_ed25519')).to.equal(keyInAlpha)
      expect(cache.get(P2, '/home/user/.ssh/id_ed25519')).to.equal(keyInBeta)
    })

    it('get() from a different project returns null even with identical keyPath', () => {
      const cache = new SigningKeyCache()
      cache.set(P1, '/shared/path', makeFakeKey('p1'))
      expect(cache.get(P2, '/shared/path')).to.be.undefined
    })

    it('invalidate() is project-scoped', () => {
      const cache = new SigningKeyCache()
      const keyInAlpha = makeFakeKey('alpha')
      const keyInBeta = makeFakeKey('beta')
      cache.set(P1, '/shared/path', keyInAlpha)
      cache.set(P2, '/shared/path', keyInBeta)

      cache.invalidate(P1, '/shared/path')

      expect(cache.get(P1, '/shared/path')).to.be.undefined
      expect(cache.get(P2, '/shared/path')).to.equal(keyInBeta)
    })
  })

  describe('size', () => {
    it('is 0 for empty cache', () => {
      const cache = new SigningKeyCache()
      expect(cache.size).to.equal(0)
    })

    it('counts non-expired entries across projects', () => {
      const cache = new SigningKeyCache()
      cache.set(P1, '/a', makeFakeKey('a'))
      cache.set(P2, '/a', makeFakeKey('b'))
      expect(cache.size).to.equal(2)
    })
  })

  describe('TTL expiry', () => {
    it('returns null after TTL expires', async function () {
      this.timeout(3000)

      const cache = new SigningKeyCache(50)
      const key = makeFakeKey('ttl-test')
      cache.set(P1, '/ttl/test', key)

      expect(cache.get(P1, '/ttl/test')).to.equal(key)

      await new Promise<void>((resolve) => { setTimeout(resolve, 100) })

      expect(cache.get(P1, '/ttl/test')).to.be.undefined
    })

    it('returns key before TTL expires', async function () {
      this.timeout(3000)

      const cache = new SigningKeyCache(500)
      const key = makeFakeKey('ttl-alive')
      cache.set(P1, '/ttl/alive', key)

      await new Promise<void>((resolve) => { setTimeout(resolve, 50) })

      expect(cache.get(P1, '/ttl/alive')).to.equal(key)
    })
  })

  describe('expired entry cleanup on set()', () => {
    it('removes expired entries when a new key is set', async function () {
      this.timeout(3000)

      const cache = new SigningKeyCache(50)
      cache.set(P1, '/old', makeFakeKey('old'))

      await new Promise<void>((resolve) => { setTimeout(resolve, 100) })

      cache.set(P1, '/new', makeFakeKey('new'))

      expect(cache.size).to.equal(1)
      expect(cache.get(P1, '/old')).to.be.undefined
      expect(cache.get(P1, '/new')).to.not.be.undefined
    })
  })

  describe('invalidate()', () => {
    it('removes a specific (project, key) pair from cache', () => {
      const cache = new SigningKeyCache()
      const key = makeFakeKey('to-clear')
      cache.set(P1, '/invalidate/me', key)
      cache.invalidate(P1, '/invalidate/me')
      expect(cache.get(P1, '/invalidate/me')).to.be.undefined
    })

    it('does not affect other cached keys when invalidating one', () => {
      const cache = new SigningKeyCache()
      const key1 = makeFakeKey('keep')
      const key2 = makeFakeKey('remove')
      cache.set(P1, '/keep', key1)
      cache.set(P1, '/remove', key2)
      cache.invalidate(P1, '/remove')
      expect(cache.get(P1, '/keep')).to.equal(key1)
      expect(cache.get(P1, '/remove')).to.be.undefined
    })
  })

  describe('invalidateAll()', () => {
    it('clears all entries across all projects', () => {
      const cache = new SigningKeyCache()
      cache.set(P1, '/a', makeFakeKey('a'))
      cache.set(P1, '/b', makeFakeKey('b'))
      cache.set(P2, '/c', makeFakeKey('c'))
      cache.invalidateAll()
      expect(cache.size).to.equal(0)
      expect(cache.get(P1, '/a')).to.be.undefined
      expect(cache.get(P2, '/c')).to.be.undefined
    })
  })
})
