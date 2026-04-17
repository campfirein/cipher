/**
 * FileVcGitConfigStore Unit Tests
 *
 * Uses a real tmpdir — no stubs needed since it's a pure filesystem utility.
 * Tests: set/get roundtrip, missing = undefined, separate projects = separate configs.
 */

import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {FileVcGitConfigStore} from '../../../../src/server/infra/vc/file-vc-git-config-store.js'

describe('FileVcGitConfigStore', () => {
  let tmpDir: string
  let store: FileVcGitConfigStore

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'brv-vc-config-test-'))
    store = new FileVcGitConfigStore({getDataDir: () => tmpDir})
  })

  afterEach(async () => {
    await rm(tmpDir, {force: true, recursive: true})
  })

  describe('get()', () => {
    it('should return undefined when config does not exist', async () => {
      const result = await store.get('/some/project')
      expect(result).to.be.undefined
    })
  })

  describe('set() + get()', () => {
    it('should persist and retrieve full config', async () => {
      await store.set('/my/project', {email: 'bao@b.dev', name: 'Bao'})
      const result = await store.get('/my/project')
      expect(result).to.deep.equal({email: 'bao@b.dev', name: 'Bao'})
    })

    it('should persist name-only config', async () => {
      await store.set('/my/project', {name: 'Bao'})
      const result = await store.get('/my/project')
      expect(result).to.deep.equal({name: 'Bao'})
    })

    it('should overwrite existing config on subsequent set', async () => {
      await store.set('/my/project', {name: 'OldName'})
      await store.set('/my/project', {email: 'new@b.dev', name: 'NewName'})
      const result = await store.get('/my/project')
      expect(result).to.deep.equal({email: 'new@b.dev', name: 'NewName'})
    })

    it('should create config dir automatically', async () => {
      // tmpDir/projects/<hash>/ does not exist yet — set() should create it
      await store.set('/any/project', {name: 'Test'})
      const result = await store.get('/any/project')
      expect(result).to.not.be.undefined
    })
  })

  describe('separate projects', () => {
    it('should store separate configs per project path', async () => {
      await store.set('/project/a', {name: 'Alice'})
      await store.set('/project/b', {name: 'Bob'})

      const a = await store.get('/project/a')
      const b = await store.get('/project/b')

      expect(a?.name).to.equal('Alice')
      expect(b?.name).to.equal('Bob')
    })

    it('should not cross-contaminate between projects', async () => {
      await store.set('/project/a', {email: 'alice@a.dev', name: 'Alice'})

      const b = await store.get('/project/b')
      expect(b).to.be.undefined
    })
  })
})
