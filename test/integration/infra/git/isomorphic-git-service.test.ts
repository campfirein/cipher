import {expect} from 'chai'
import {existsSync} from 'node:fs'
import {mkdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {stub} from 'sinon'

import type {IAuthStateStore} from '../../../../src/server/core/interfaces/state/i-auth-state-store.js'

import {GitAuthError, GitError} from '../../../../src/server/core/domain/errors/git-error.js'
import {IsomorphicGitService} from '../../../../src/server/infra/git/isomorphic-git-service.js'

const COGIT_BASE = 'https://git.cogit.byterover.com'

function makeTestDir(): string {
  return join(tmpdir(), `brv-git-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
}

function makeAuth(overrides?: {getToken?: () => unknown}): IAuthStateStore {
  return {
    getToken:
      overrides?.getToken ??
      stub().returns({
        accessToken: 'test-access-token',
        expiresAt: new Date(Date.now() + 3_600_000),
        refreshToken: 'test-refresh-token',
        sessionKey: 'test-session-key',
        userEmail: 'test@example.com',
        userId: 'test-user-uuid',
      }),
    loadToken: stub().resolves(),
    onAuthChanged: stub(),
    onAuthExpired: stub(),
    startPolling: stub(),
    stopPolling: stub(),
  } as unknown as IAuthStateStore
}

describe('IsomorphicGitService', () => {
  let testDir: string
  let service: IsomorphicGitService

  beforeEach(async () => {
    testDir = makeTestDir()
    await mkdir(testDir, {recursive: true})
    service = new IsomorphicGitService(makeAuth(), {cogitGitBaseUrl: COGIT_BASE})
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

  // ---- add() + commit() ----

  describe('add() and commit()', () => {
    beforeEach(async () => {
      await service.init({directory: testDir})
    })

    it('creates a commit and returns GitCommit shape', async () => {
      await writeFile(join(testDir, 'hello.txt'), 'world')
      await service.add({directory: testDir, filePaths: ['hello.txt']})
      const commit = await service.commit({directory: testDir, message: 'initial commit'})

      expect(commit.sha).to.be.a('string').with.length(40)
      expect(commit.message).to.equal('initial commit')
      expect(commit.author.email).to.equal('test@example.com')
      expect(commit.timestamp).to.be.instanceOf(Date)
    })

    it('uses explicit author when provided', async () => {
      await writeFile(join(testDir, 'a.txt'), 'a')
      await service.add({directory: testDir, filePaths: ['a.txt']})
      const commit = await service.commit({
        author: {email: 'custom@example.com', name: 'Custom'},
        directory: testDir,
        message: 'custom author',
      })

      expect(commit.author.email).to.equal('custom@example.com')
      expect(commit.author.name).to.equal('Custom')
    })

    it('stages multiple files', async () => {
      await writeFile(join(testDir, 'a.txt'), 'a')
      await writeFile(join(testDir, 'b.txt'), 'b')
      await service.add({directory: testDir, filePaths: ['a.txt', 'b.txt']})
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

    it('reports new untracked file as added', async () => {
      await writeFile(join(testDir, 'new.txt'), 'content')
      const result = await service.status({directory: testDir})

      expect(result.isClean).to.be.false
      expect(result.files).to.have.length(1)
      expect(result.files[0]).to.deep.equal({path: 'new.txt', status: 'added'})
    })

    it('reports modified committed file as modified', async () => {
      await writeFile(join(testDir, 'tracked.txt'), 'original')
      await service.add({directory: testDir, filePaths: ['tracked.txt']})
      await service.commit({directory: testDir, message: 'initial'})

      await writeFile(join(testDir, 'tracked.txt'), 'changed')
      const result = await service.status({directory: testDir})

      expect(result.isClean).to.be.false
      const file = result.files.find((f) => f.path === 'tracked.txt')
      expect(file?.status).to.equal('modified')
    })

    it('returns isClean: true after commit with no further changes', async () => {
      await writeFile(join(testDir, 'tracked.txt'), 'content')
      await service.add({directory: testDir, filePaths: ['tracked.txt']})
      await service.commit({directory: testDir, message: 'initial'})

      const result = await service.status({directory: testDir})
      expect(result.isClean).to.be.true
      expect(result.files).to.be.empty
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
      await writeFile(join(testDir, 'f.txt'), 'x')
      await service.add({directory: testDir, filePaths: ['f.txt']})
      await service.commit({directory: testDir, message: 'first'})

      const commits = await service.log({directory: testDir})
      expect(commits).to.have.length(1)
      expect(commits[0].sha).to.be.a('string').with.length(40)
      expect(commits[0].message).to.equal('first')
      expect(commits[0].author.email).to.equal('test@example.com')
      expect(commits[0].timestamp).to.be.instanceOf(Date)
    })

    it('respects depth limit', async () => {
      await writeFile(join(testDir, 'f.txt'), 'x')
      await service.add({directory: testDir, filePaths: ['f.txt']})
      await service.commit({directory: testDir, message: 'first'})

      await writeFile(join(testDir, 'f.txt'), 'y')
      await service.add({directory: testDir, filePaths: ['f.txt']})
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
      await writeFile(join(testDir, 'seed.txt'), 'seed')
      await service.add({directory: testDir, filePaths: ['seed.txt']})
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
      await writeFile(join(testDir, 'seed.txt'), 'seed')
      await service.add({directory: testDir, filePaths: ['seed.txt']})
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

    it('returns empty array on clean repo', async () => {
      await writeFile(join(testDir, 'clean.txt'), 'no conflicts')
      const conflicts = await service.getConflicts({directory: testDir})
      expect(conflicts).to.be.empty
    })

    it('detects conflict markers in a file', async () => {
      const conflictContent = '<<<<<<< HEAD\nA\n=======\nB\n>>>>>>> feature'
      await writeFile(join(testDir, 'conflict.txt'), conflictContent)
      const conflicts = await service.getConflicts({directory: testDir})

      expect(conflicts).to.have.length(1)
      expect(conflicts[0].path).to.equal('conflict.txt')
      expect(conflicts[0].type).to.equal('both_modified')
    })

    it('detects conflicts in nested directories', async () => {
      await mkdir(join(testDir, 'sub'), {recursive: true})
      await writeFile(join(testDir, 'sub', 'nested.txt'), '<<<<<<< HEAD\nA\n=======\nB\n>>>>>>>')
      const conflicts = await service.getConflicts({directory: testDir})

      expect(conflicts).to.have.length(1)
      expect(conflicts[0].path).to.equal(join('sub', 'nested.txt'))
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

    it('buildCogitRemoteUrl produces correct URL', () => {
      const url = service.buildCogitRemoteUrl('team-123', 'space-456')
      expect(url).to.equal(`${COGIT_BASE}/git/team-123/space-456.git`)
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
      const noAuthService = new IsomorphicGitService(makeAuth({getToken() {}}), {cogitGitBaseUrl: COGIT_BASE})

      await service.init({directory: testDir})
      // Remote is required — onAuth is only invoked when isomorphic-git has a URL to connect to
      await service.addRemote({directory: testDir, remote: 'origin', url: `${COGIT_BASE}/git/team-1/space-1.git`})
      await writeFile(join(testDir, 'f.txt'), 'x')
      await service.add({directory: testDir, filePaths: ['f.txt']})
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
