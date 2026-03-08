import {expect} from 'chai'
import * as git from 'isomorphic-git'
import fs, {existsSync} from 'node:fs'
import {mkdir, rm, unlink, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {stub} from 'sinon'

import type {IAuthStateStore} from '../../../../src/server/core/interfaces/state/i-auth-state-store.js'

import {AuthToken} from '../../../../src/server/core/domain/entities/auth-token.js'
import {GitAuthError, GitError} from '../../../../src/server/core/domain/errors/git-error.js'
import {IsomorphicGitService} from '../../../../src/server/infra/git/isomorphic-git-service.js'

const COGIT_BASE = 'https://fake-cgit.example.com'

function makeTestDir(): string {
  return join(tmpdir(), `brv-git-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
}

function makeAuth(options?: {noAuth: true}): IAuthStateStore {
  const defaultToken = new AuthToken({
    accessToken: 'test-access-token',
    expiresAt: new Date(Date.now() + 3_600_000),
    refreshToken: 'test-refresh-token',
    sessionKey: 'test-session-key',
    userEmail: 'test@example.com',
    userId: 'test-user-uuid',
  })
  return {
    getToken: stub<[], AuthToken | undefined>().returns(options?.noAuth ? undefined : defaultToken),
    loadToken: stub<[], Promise<AuthToken | undefined>>().resolves(),
    onAuthChanged: stub(),
    onAuthExpired: stub(),
    startPolling: stub(),
    stopPolling: stub(),
  }
}

describe('IsomorphicGitService', () => {
  let testDir: string
  let service: IsomorphicGitService

  beforeEach(async () => {
    testDir = makeTestDir()
    await mkdir(testDir, {recursive: true})
    service = new IsomorphicGitService(makeAuth())
  })

  afterEach(async () => {
    if (existsSync(testDir)) {
      await rm(testDir, {force: true, recursive: true})
    }
  })

  // ---- init() ----

  describe('init()', () => {
    it('creates a .git directory', async () => {
      await service.init({directory: testDir})
      expect(existsSync(join(testDir, '.git'))).to.be.true
    })

    it('defaults to main branch', async () => {
      await service.init({directory: testDir})
      const branch = await service.getCurrentBranch({directory: testDir})
      expect(branch).to.equal('main')
    })

    it('respects defaultBranch param', async () => {
      await service.init({defaultBranch: 'trunk', directory: testDir})
      const branch = await service.getCurrentBranch({directory: testDir})
      expect(branch).to.equal('trunk')
    })
  })

  // ---- isInitialized() ----

  describe('isInitialized()', () => {
    it('returns false when no .git directory exists', async () => {
      expect(await service.isInitialized({directory: testDir})).to.be.false
    })

    it('returns true after init()', async () => {
      await service.init({directory: testDir})
      expect(await service.isInitialized({directory: testDir})).to.be.true
    })
  })

  // ---- add() + commit() ----

  describe('add() and commit()', () => {
    beforeEach(async () => {
      await service.init({directory: testDir})
    })

    it('creates a commit and returns GitCommit shape', async () => {
      await writeFile(join(testDir, 'hello.md'), 'world')
      await service.add({directory: testDir, filePaths: ['hello.md']})
      const commit = await service.commit({directory: testDir, message: 'initial commit'})

      expect(commit.sha).to.be.a('string').with.length(40)
      expect(commit.message).to.equal('initial commit')
      expect(commit.author.email).to.equal('test@example.com')
      expect(commit.timestamp).to.be.instanceOf(Date)
    })

    it('uses explicit author when provided', async () => {
      await writeFile(join(testDir, 'a.md'), 'a')
      await service.add({directory: testDir, filePaths: ['a.md']})
      const commit = await service.commit({
        author: {email: 'custom@example.com', name: 'Custom'},
        directory: testDir,
        message: 'custom author',
      })

      expect(commit.author.email).to.equal('custom@example.com')
      expect(commit.author.name).to.equal('Custom')
    })

    it('stages multiple files', async () => {
      await writeFile(join(testDir, 'a.md'), 'a')
      await writeFile(join(testDir, 'b.md'), 'b')
      await service.add({directory: testDir, filePaths: ['a.md', 'b.md']})
      const commit = await service.commit({directory: testDir, message: 'two files'})
      expect(commit.sha).to.be.a('string')
    })
  })

  // ---- status() ----

  describe('status()', () => {
    beforeEach(async () => {
      await service.init({directory: testDir})
    })

    it('returns isClean: true on empty repo', async () => {
      const result = await service.status({directory: testDir})
      expect(result.isClean).to.be.true
      expect(result.files).to.be.empty
    })

    it('reports new untracked file as untracked with staged: false', async () => {
      await writeFile(join(testDir, 'new.md'), 'content')
      const result = await service.status({directory: testDir})

      expect(result.isClean).to.be.false
      expect(result.files).to.have.length(1)
      expect(result.files[0]).to.deep.equal({path: 'new.md', staged: false, status: 'untracked'})
    })

    it('reports staged new file as added with staged: true', async () => {
      await writeFile(join(testDir, 'new.md'), 'content')
      await service.add({directory: testDir, filePaths: ['new.md']})
      const result = await service.status({directory: testDir})

      expect(result.isClean).to.be.false
      expect(result.files).to.have.length(1)
      expect(result.files[0]).to.deep.equal({path: 'new.md', staged: true, status: 'added'})
    })

    it('reports unstaged modification as modified with staged: false', async () => {
      await writeFile(join(testDir, 'tracked.md'), 'original')
      await service.add({directory: testDir, filePaths: ['tracked.md']})
      await service.commit({directory: testDir, message: 'initial'})

      await writeFile(join(testDir, 'tracked.md'), 'changed')
      const result = await service.status({directory: testDir})

      expect(result.isClean).to.be.false
      const file = result.files.find((f) => f.path === 'tracked.md')
      expect(file).to.deep.equal({path: 'tracked.md', staged: false, status: 'modified'})
    })

    it('reports staged modification as modified with staged: true', async () => {
      await writeFile(join(testDir, 'tracked.md'), 'original')
      await service.add({directory: testDir, filePaths: ['tracked.md']})
      await service.commit({directory: testDir, message: 'initial'})

      await writeFile(join(testDir, 'tracked.md'), 'changed')
      await service.add({directory: testDir, filePaths: ['tracked.md']})
      const result = await service.status({directory: testDir})

      expect(result.isClean).to.be.false
      const file = result.files.find((f) => f.path === 'tracked.md')
      expect(file).to.deep.equal({path: 'tracked.md', staged: true, status: 'modified'})
    })

    it('reports modified committed file (not staged) as modified with staged: false', async () => {
      await writeFile(join(testDir, 'tracked.md'), 'original')
      await service.add({directory: testDir, filePaths: ['tracked.md']})
      await service.commit({directory: testDir, message: 'initial'})

      await writeFile(join(testDir, 'tracked.md'), 'changed')
      const result = await service.status({directory: testDir})

      expect(result.isClean).to.be.false
      const file = result.files.find((f) => f.path === 'tracked.md')
      expect(file?.status).to.equal('modified')
      expect(file?.staged).to.be.false
    })

    it('returns isClean: true after commit with no further changes', async () => {
      await writeFile(join(testDir, 'tracked.md'), 'content')
      await service.add({directory: testDir, filePaths: ['tracked.md']})
      await service.commit({directory: testDir, message: 'initial'})

      const result = await service.status({directory: testDir})
      expect(result.isClean).to.be.true
      expect(result.files).to.be.empty
    })

    it('[1,0,1] reports unstaged deletion (rm without git rm) as deleted with staged: false', async () => {
      await writeFile(join(testDir, 'tracked.md'), 'content')
      await service.add({directory: testDir, filePaths: ['tracked.md']})
      await service.commit({directory: testDir, message: 'initial'})

      await unlink(join(testDir, 'tracked.md')) // delete from disk only, not from index
      const result = await service.status({directory: testDir})

      expect(result.isClean).to.be.false
      const file = result.files.find((f) => f.path === 'tracked.md')
      expect(file).to.deep.equal({path: 'tracked.md', staged: false, status: 'deleted'})
    })

    it('[1,2,3] reports partially staged modification as both staged and unstaged modified', async () => {
      await writeFile(join(testDir, 'tracked.md'), 'original')
      await service.add({directory: testDir, filePaths: ['tracked.md']})
      await service.commit({directory: testDir, message: 'initial'})

      await writeFile(join(testDir, 'tracked.md'), 'change A')
      await service.add({directory: testDir, filePaths: ['tracked.md']}) // stage change A
      await writeFile(join(testDir, 'tracked.md'), 'change A + change B') // unstaged change B
      const result = await service.status({directory: testDir})

      expect(result.isClean).to.be.false
      const entries = result.files.filter((f) => f.path === 'tracked.md')
      expect(entries).to.have.length(2)
      expect(entries).to.deep.include({path: 'tracked.md', staged: true, status: 'modified'})
      expect(entries).to.deep.include({path: 'tracked.md', staged: false, status: 'modified'})
    })

    it('[1,0,0] reports staged deletion (git rm) as deleted with staged: true', async () => {
      await writeFile(join(testDir, 'tracked.md'), 'content')
      await service.add({directory: testDir, filePaths: ['tracked.md']})
      await service.commit({directory: testDir, message: 'initial'})

      // git rm: remove from both index and workdir → staged deletion [1,0,0]
      await git.remove({dir: testDir, filepath: 'tracked.md', fs})
      await unlink(join(testDir, 'tracked.md'))
      const result = await service.status({directory: testDir})

      expect(result.isClean).to.be.false
      const file = result.files.find((f) => f.path === 'tracked.md')
      expect(file).to.deep.equal({path: 'tracked.md', staged: true, status: 'deleted'})
    })

    it('[1,1,0] git rm --cached reports staged deletion and file as untracked', async () => {
      await writeFile(join(testDir, 'tracked.md'), 'content')
      await service.add({directory: testDir, filePaths: ['tracked.md']})
      await service.commit({directory: testDir, message: 'initial'})

      // git rm --cached: remove from index but keep file on disk
      await git.remove({dir: testDir, filepath: 'tracked.md', fs})
      const result = await service.status({directory: testDir})

      expect(result.isClean).to.be.false
      const entries = result.files.filter((f) => f.path === 'tracked.md')
      expect(entries).to.have.length(2)
      expect(entries).to.deep.include({path: 'tracked.md', staged: true, status: 'deleted'})
      expect(entries).to.deep.include({path: 'tracked.md', staged: false, status: 'untracked'})
    })

    it('[0,2,3] reports partially staged new file as staged added + unstaged modified', async () => {
      // new file: add to index (staged added), then modify on disk without re-staging
      await writeFile(join(testDir, 'new.md'), 'original')
      await service.add({directory: testDir, filePaths: ['new.md']})
      await writeFile(join(testDir, 'new.md'), 'changed after staging') // unstaged change
      const result = await service.status({directory: testDir})

      expect(result.isClean).to.be.false
      const entries = result.files.filter((f) => f.path === 'new.md')
      expect(entries).to.have.length(2)
      expect(entries).to.deep.include({path: 'new.md', staged: true, status: 'added'})
      expect(entries).to.deep.include({path: 'new.md', staged: false, status: 'modified'})
    })

    it('reports correct statuses for multiple files with mixed states', async () => {
      // Setup: one committed file (becomes base for HEAD entries)
      await writeFile(join(testDir, 'committed.md'), 'content')
      await service.add({directory: testDir, filePaths: ['committed.md']})
      await service.commit({directory: testDir, message: 'initial'})

      // staged deletion [1,0,0]
      await git.remove({dir: testDir, filepath: 'committed.md', fs})
      await unlink(join(testDir, 'committed.md'))

      // staged new file [0,2,2]
      await writeFile(join(testDir, 'added.md'), 'new')
      await service.add({directory: testDir, filePaths: ['added.md']})

      // untracked [0,2,0]
      await writeFile(join(testDir, 'untracked.md'), 'raw')

      const result = await service.status({directory: testDir})

      expect(result.isClean).to.be.false
      expect(result.files).to.deep.include({path: 'committed.md', staged: true, status: 'deleted'})
      expect(result.files).to.deep.include({path: 'added.md', staged: true, status: 'added'})
      expect(result.files).to.deep.include({path: 'untracked.md', staged: false, status: 'untracked'})
    })
  })

  // ---- log() ----

  describe('log()', () => {
    beforeEach(async () => {
      await service.init({directory: testDir})
    })

    it('returns empty array when no commits exist', async () => {
      const commits = await service.log({directory: testDir})
      expect(commits).to.be.an('array').that.is.empty
    })

    it('returns commits with correct shape', async () => {
      await writeFile(join(testDir, 'f.md'), 'x')
      await service.add({directory: testDir, filePaths: ['f.md']})
      await service.commit({directory: testDir, message: 'first'})

      const commits = await service.log({directory: testDir})
      expect(commits).to.have.length(1)
      expect(commits[0].sha).to.be.a('string').with.length(40)
      expect(commits[0].message).to.equal('first')
      expect(commits[0].author.email).to.equal('test@example.com')
      expect(commits[0].timestamp).to.be.instanceOf(Date)
    })

    it('respects depth limit', async () => {
      await writeFile(join(testDir, 'f.md'), 'x')
      await service.add({directory: testDir, filePaths: ['f.md']})
      await service.commit({directory: testDir, message: 'first'})

      await writeFile(join(testDir, 'f.md'), 'y')
      await service.add({directory: testDir, filePaths: ['f.md']})
      await service.commit({directory: testDir, message: 'second'})

      const commits = await service.log({depth: 1, directory: testDir})
      expect(commits).to.have.length(1)
    })
  })

  // ---- createBranch() + listBranches() + getCurrentBranch() ----

  describe('branch management', () => {
    beforeEach(async () => {
      await service.init({directory: testDir})
      // Need at least one commit before branch refs exist
      await writeFile(join(testDir, 'seed.md'), 'seed')
      await service.add({directory: testDir, filePaths: ['seed.md']})
      await service.commit({directory: testDir, message: 'seed'})
    })

    it('listBranches returns main after first commit', async () => {
      const branches = await service.listBranches({directory: testDir})
      expect(branches).to.have.length(1)
      expect(branches[0].name).to.equal('main')
      expect(branches[0].isCurrent).to.be.true
    })

    it('createBranch adds a new branch', async () => {
      await service.createBranch({branch: 'feature', directory: testDir})
      const branches = await service.listBranches({directory: testDir})
      const names = branches.map((b) => b.name)
      expect(names).to.include('feature')
      expect(names).to.include('main')
    })

    it('isCurrent is false for non-active branch', async () => {
      await service.createBranch({branch: 'feature', directory: testDir})
      const branches = await service.listBranches({directory: testDir})
      const feature = branches.find((b) => b.name === 'feature')
      expect(feature?.isCurrent).to.be.false
    })

    it('getCurrentBranch returns main initially', async () => {
      const branch = await service.getCurrentBranch({directory: testDir})
      expect(branch).to.equal('main')
    })
  })

  // ---- checkout() ----

  describe('checkout()', () => {
    beforeEach(async () => {
      await service.init({directory: testDir})
      await writeFile(join(testDir, 'seed.md'), 'seed')
      await service.add({directory: testDir, filePaths: ['seed.md']})
      await service.commit({directory: testDir, message: 'seed'})
      await service.createBranch({branch: 'feature', directory: testDir})
    })

    it('switches to a different branch', async () => {
      await service.checkout({directory: testDir, ref: 'feature'})
      const branch = await service.getCurrentBranch({directory: testDir})
      expect(branch).to.equal('feature')
    })
  })

  // ---- getConflicts() ----

  describe('getConflicts()', () => {
    beforeEach(async () => {
      await service.init({directory: testDir})
    })

    it('returns empty array when no merge in progress', async () => {
      await writeFile(join(testDir, 'clean.md'), 'no conflicts')
      const conflicts = await service.getConflicts({directory: testDir})
      expect(conflicts).to.be.empty
    })

    it('detects both_modified conflict when MERGE_HEAD exists', async () => {
      // Commit a tracked file so statusMatrix has baseline
      await writeFile(join(testDir, 'file.md'), 'initial')
      await service.add({directory: testDir, filePaths: ['file.md']})
      await service.commit({directory: testDir, message: 'initial'})

      // Simulate native git merge conflict state:
      // native git writes MERGE_HEAD and conflict markers; isomorphic-git does not
      await writeFile(join(testDir, '.git', 'MERGE_HEAD'), 'deadbeef\n')
      await writeFile(join(testDir, 'file.md'), '<<<<<<< HEAD\nmain\n=======\nfeature\n>>>>>>> feature')

      const conflicts = await service.getConflicts({directory: testDir})
      expect(conflicts).to.have.length(1)
      expect(conflicts[0].path).to.equal('file.md')
      expect(conflicts[0].type).to.equal('both_modified')
    })

    it('detects both_added conflict when new file has conflict markers', async () => {
      // File does NOT exist in HEAD (never committed), appears in workdir with conflict markers
      await writeFile(join(testDir, '.git', 'MERGE_HEAD'), 'deadbeef\n')
      await writeFile(join(testDir, 'brand-new.md'), '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch')

      const conflicts = await service.getConflicts({directory: testDir})
      expect(conflicts).to.have.length(1)
      expect(conflicts[0].path).to.equal('brand-new.md')
      expect(conflicts[0].type).to.equal('both_added')
    })

    it('detects deleted_modified conflict when tracked file is deleted from workdir', async () => {
      // File exists in HEAD but is deleted from workdir
      await writeFile(join(testDir, 'tracked.md'), 'content')
      await service.add({directory: testDir, filePaths: ['tracked.md']})
      await service.commit({directory: testDir, message: 'add tracked'})

      await writeFile(join(testDir, '.git', 'MERGE_HEAD'), 'deadbeef\n')
      await unlink(join(testDir, 'tracked.md'))

      const conflicts = await service.getConflicts({directory: testDir})
      expect(conflicts).to.have.length(1)
      expect(conflicts[0].path).to.equal('tracked.md')
      expect(conflicts[0].type).to.equal('deleted_modified')
    })

    it('detects conflicts in nested directories', async () => {
      // Commit a tracked nested file
      await mkdir(join(testDir, 'sub'), {recursive: true})
      await writeFile(join(testDir, 'sub', 'nested.md'), 'initial')
      await service.add({directory: testDir, filePaths: ['sub/nested.md']})
      await service.commit({directory: testDir, message: 'initial'})

      // Simulate native git merge conflict state
      await writeFile(join(testDir, '.git', 'MERGE_HEAD'), 'deadbeef\n')
      await writeFile(join(testDir, 'sub', 'nested.md'), '<<<<<<< HEAD\nmain\n=======\nfeature\n>>>>>>> feature')

      const conflicts = await service.getConflicts({directory: testDir})
      expect(conflicts).to.have.length(1)
      expect(conflicts[0].path).to.equal(join('sub', 'nested.md'))
      expect(conflicts[0].type).to.equal('both_modified')
    })
  })

  // ---- merge() ----

  describe('merge()', () => {
    beforeEach(async () => {
      await service.init({directory: testDir})
      await writeFile(join(testDir, 'a.md'), 'base')
      await service.add({directory: testDir, filePaths: ['a.md']})
      await service.commit({directory: testDir, message: 'base'})
    })

    it('returns success: true for clean merge (different files)', async () => {
      await service.createBranch({branch: 'feature', directory: testDir})
      await service.checkout({directory: testDir, ref: 'feature'})
      await writeFile(join(testDir, 'b.md'), 'new')
      await service.add({directory: testDir, filePaths: ['b.md']})
      await service.commit({directory: testDir, message: 'feature'})

      await service.checkout({directory: testDir, ref: 'main'})
      const result = await service.merge({branch: 'feature', directory: testDir})
      expect(result.success).to.be.true
    })

    it('returns conflicts for both_modified case', async () => {
      await service.createBranch({branch: 'feature', directory: testDir})
      await service.checkout({directory: testDir, ref: 'feature'})
      await writeFile(join(testDir, 'a.md'), 'feature version')
      await service.add({directory: testDir, filePaths: ['a.md']})
      await service.commit({directory: testDir, message: 'feature change'})

      await service.checkout({directory: testDir, ref: 'main'})
      await writeFile(join(testDir, 'a.md'), 'main version')
      await service.add({directory: testDir, filePaths: ['a.md']})
      await service.commit({directory: testDir, message: 'main change'})

      const result = await service.merge({branch: 'feature', directory: testDir})
      expect(result.success).to.be.false
      if (!result.success) {
        expect(result.conflicts).to.have.length(1)
        expect(result.conflicts[0].path).to.equal('a.md')
        expect(result.conflicts[0].type).to.equal('both_modified')
      }
    })

    it('writes MERGE_HEAD after conflict so getConflicts() works post-restart', async () => {
      await service.createBranch({branch: 'feature', directory: testDir})
      await service.checkout({directory: testDir, ref: 'feature'})
      await writeFile(join(testDir, 'a.md'), 'feature version')
      await service.add({directory: testDir, filePaths: ['a.md']})
      await service.commit({directory: testDir, message: 'feature'})

      await service.checkout({directory: testDir, ref: 'main'})
      await writeFile(join(testDir, 'a.md'), 'main version')
      await service.add({directory: testDir, filePaths: ['a.md']})
      await service.commit({directory: testDir, message: 'main'})

      await service.merge({branch: 'feature', directory: testDir})

      // Simulate post-restart: call getConflicts() without the original error
      const conflicts = await service.getConflicts({directory: testDir})
      expect(conflicts).to.have.length(1)
      expect(conflicts[0].path).to.equal('a.md')
    })
  })

  // ---- remote management ----

  describe('remote management', () => {
    beforeEach(async () => {
      await service.init({directory: testDir})
    })

    it('addRemote + listRemotes', async () => {
      await service.addRemote({directory: testDir, remote: 'origin', url: `${COGIT_BASE}/git/team-1/space-1.git`})
      const remotes = await service.listRemotes({directory: testDir})

      expect(remotes).to.have.length(1)
      expect(remotes[0].remote).to.equal('origin')
      expect(remotes[0].url).to.equal(`${COGIT_BASE}/git/team-1/space-1.git`)
    })

    it('listRemotes returns empty array when no remotes', async () => {
      const remotes = await service.listRemotes({directory: testDir})
      expect(remotes).to.be.empty
    })

    it('getRemoteUrl returns URL for existing remote', async () => {
      const url = `${COGIT_BASE}/git/team-1/space-1.git`
      await service.addRemote({directory: testDir, remote: 'origin', url})
      expect(await service.getRemoteUrl({directory: testDir, remote: 'origin'})).to.equal(url)
    })

    it('getRemoteUrl returns undefined for missing remote', async () => {
      expect(await service.getRemoteUrl({directory: testDir, remote: 'nonexistent'})).to.be.undefined
    })

    it('removeRemote deletes the remote', async () => {
      await service.addRemote({directory: testDir, remote: 'origin', url: 'https://example.com/1.git'})
      await service.removeRemote({directory: testDir, remote: 'origin'})
      expect(await service.listRemotes({directory: testDir})).to.be.empty
    })
  })

  // ---- error handling ----

  describe('error handling', () => {
    it('throws GitError when directory is empty string', async () => {
      try {
        await service.status({directory: ''})
        expect.fail('should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(GitError)
      }
    })

    it('throws GitAuthError when pushing without a token', async () => {
      const noAuthService = new IsomorphicGitService(makeAuth({noAuth: true}))

      await service.init({directory: testDir})
      // Remote is required — onAuth is only invoked when isomorphic-git has a URL to connect to
      await service.addRemote({directory: testDir, remote: 'origin', url: `${COGIT_BASE}/git/team-1/space-1.git`})
      await writeFile(join(testDir, 'f.md'), 'x')
      await service.add({directory: testDir, filePaths: ['f.md']})
      await service.commit({directory: testDir, message: 'init'})

      try {
        await noAuthService.push({directory: testDir})
        expect.fail('should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(GitAuthError)
      }
    })
  })
})
