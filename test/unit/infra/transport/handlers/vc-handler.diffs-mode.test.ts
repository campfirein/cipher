/**
 * VcHandler — handleDiffs (mode-based call) tests
 *
 * Tests the multi-file, ref-aware branch of `vc:diffs` that powers `brv vc diff` / `/vc diff`.
 * Covers all 4 modes (unstaged, staged, ref-vs-worktree, range), binary detection,
 * 1 MB truncation cap, and GIT_NOT_INITIALIZED guard.
 */

import {expect} from 'chai'
import {existsSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {ITokenStore} from '../../../../../src/server/core/interfaces/auth/i-token-store.js'
import type {IContextTreeService} from '../../../../../src/server/core/interfaces/context-tree/i-context-tree-service.js'
import type {IGitService} from '../../../../../src/server/core/interfaces/services/i-git-service.js'
import type {ISpaceService} from '../../../../../src/server/core/interfaces/services/i-space-service.js'
import type {ITeamService} from '../../../../../src/server/core/interfaces/services/i-team-service.js'
import type {IProjectConfigStore} from '../../../../../src/server/core/interfaces/storage/i-project-config-store.js'
import type {
  ITransportServer,
  RequestHandler,
} from '../../../../../src/server/core/interfaces/transport/i-transport-server.js'
import type {IVcGitConfigStore} from '../../../../../src/server/core/interfaces/vc/i-vc-git-config-store.js'

import {AuthToken} from '../../../../../src/server/core/domain/entities/auth-token.js'
import {VcError} from '../../../../../src/server/core/domain/errors/vc-error.js'
import {VcHandler} from '../../../../../src/server/infra/transport/handlers/vc-handler.js'
import {
  type IVcDiffsRequest,
  type IVcDiffsResponse,
  VcErrorCode,
  VcEvents,
} from '../../../../../src/shared/transport/events/vc-events.js'

type Stubbed<T> = {[K in keyof T]: SinonStub & T[K]}

const CLIENT_ID = 'client-abc'

interface TestDeps {
  broadcastToProject: SinonStub
  contextTreeDir: string
  contextTreeService: Stubbed<IContextTreeService>
  gitService: Stubbed<IGitService>
  projectConfigStore: Stubbed<IProjectConfigStore>
  requestHandlers: Record<string, RequestHandler>
  resolveProjectPath: SinonStub
  spaceService: Stubbed<ISpaceService>
  teamService: Stubbed<ITeamService>
  tokenStore: Stubbed<ITokenStore>
  transport: Stubbed<ITransportServer>
  vcGitConfigStore: Stubbed<IVcGitConfigStore>
}

function makeGitService(sandbox: SinonSandbox): Stubbed<IGitService> {
  return {
    abortMerge: sandbox.stub().resolves(),
    add: sandbox.stub().resolves(),
    addRemote: sandbox.stub().resolves(),
    checkout: sandbox.stub().resolves(),
    clone: sandbox.stub().resolves(),
    commit: sandbox.stub().resolves(),
    createBranch: sandbox.stub().resolves(),
    deleteBranch: sandbox.stub().resolves(),
    fetch: sandbox.stub().resolves(),
    getAheadBehind: sandbox.stub().resolves({ahead: 0, behind: 0}),
    getBlobContent: sandbox.stub().resolves(),
    getBlobContents: sandbox.stub().resolves({}),
    getConflicts: sandbox.stub().resolves([]),
    getCurrentBranch: sandbox.stub().resolves('main'),
    getFilesWithConflictMarkers: sandbox.stub().resolves([]),
    getRemoteUrl: sandbox.stub().resolves(),
    getTextBlob: sandbox.stub().resolves(),
    getTrackingBranch: sandbox.stub().resolves(),
    hashBlob: sandbox.stub().resolves('0000000'),
    init: sandbox.stub().resolves(),
    isAncestor: sandbox.stub().resolves(true),
    isEmptyRepository: sandbox.stub().resolves(false),
    isInitialized: sandbox.stub().resolves(true),
    listBranches: sandbox.stub().resolves([]),
    listChangedFiles: sandbox.stub().resolves([]),
    listRemotes: sandbox.stub().resolves([]),
    log: sandbox.stub().resolves([]),
    merge: sandbox.stub().resolves({success: true}),
    pull: sandbox.stub().resolves({success: true}),
    push: sandbox.stub().resolves({success: true}),
    removeRemote: sandbox.stub().resolves(),
    reset: sandbox.stub().resolves({filesChanged: 0, headSha: 'abc'}),
    setTrackingBranch: sandbox.stub().resolves(),
    status: sandbox.stub().resolves({files: [], isClean: true}),
  } as unknown as Stubbed<IGitService>
}

function makeDeps(sandbox: SinonSandbox, projectPath: string, contextTreeDir: string): TestDeps {
  const contextTreeService: Stubbed<IContextTreeService> = {
    delete: sandbox.stub().resolves(),
    exists: sandbox.stub().resolves(false),
    hasGitRepo: sandbox.stub().resolves(false),
    initialize: sandbox.stub().resolves(contextTreeDir),
    resolvePath: sandbox.stub().returns(contextTreeDir),
  }

  const gitService = makeGitService(sandbox)

  const vcGitConfigStore: Stubbed<IVcGitConfigStore> = {
    get: sandbox.stub().resolves(),
    set: sandbox.stub().resolves(),
  }

  const resolveProjectPath = sandbox.stub().returns(projectPath)
  const teamService: Stubbed<ITeamService> = {getTeams: sandbox.stub().resolves({teams: [], total: 0})}
  const spaceService: Stubbed<ISpaceService> = {getSpaces: sandbox.stub().resolves({spaces: [], total: 0})}

  const tokenStore: Stubbed<ITokenStore> = {
    clear: sandbox.stub().resolves(),
    load: sandbox.stub().resolves(
      new AuthToken({
        accessToken: 'a',
        expiresAt: new Date(Date.now() + 3_600_000),
        refreshToken: 'r',
        sessionKey: 's',
        userEmail: 'u@example.com',
        userId: 'u1',
      }),
    ),
    save: sandbox.stub().resolves(),
  }

  const requestHandlers: Record<string, RequestHandler> = {}
  const transport: Stubbed<ITransportServer> = {
    addToRoom: sandbox.stub(),
    broadcast: sandbox.stub(),
    broadcastTo: sandbox.stub(),
    getPort: sandbox.stub(),
    isRunning: sandbox.stub(),
    onConnection: sandbox.stub(),
    onDisconnection: sandbox.stub(),
    onRequest: sandbox.stub().callsFake((event: string, handler: RequestHandler) => {
      requestHandlers[event] = handler
    }),
    removeFromRoom: sandbox.stub(),
    sendTo: sandbox.stub(),
    start: sandbox.stub().resolves(),
    stop: sandbox.stub().resolves(),
  }

  const projectConfigStore: Stubbed<IProjectConfigStore> = {
    exists: sandbox.stub().resolves(false),
    getModifiedTime: sandbox.stub().resolves(),
    read: sandbox.stub().resolves(),
    write: sandbox.stub().resolves(),
  }

  return {
    broadcastToProject: sandbox.stub(),
    contextTreeDir,
    contextTreeService,
    gitService,
    projectConfigStore,
    requestHandlers,
    resolveProjectPath,
    spaceService,
    teamService,
    tokenStore,
    transport,
    vcGitConfigStore,
  }
}

function makeVcHandler(deps: TestDeps): VcHandler {
  return new VcHandler({
    broadcastToProject: deps.broadcastToProject,
    contextTreeService: deps.contextTreeService,
    gitRemoteBaseUrl: 'https://byterover.dev',
    gitService: deps.gitService,
    projectConfigStore: deps.projectConfigStore,
    resolveProjectPath: deps.resolveProjectPath,
    spaceService: deps.spaceService,
    teamService: deps.teamService,
    tokenStore: deps.tokenStore,
    transport: deps.transport,
    vcGitConfigStore: deps.vcGitConfigStore,
    webAppUrl: 'https://app.byterover.dev',
  })
}

function invoke(deps: TestDeps, request: IVcDiffsRequest): Promise<IVcDiffsResponse> {
  return deps.requestHandlers[VcEvents.DIFFS](request, CLIENT_ID) as Promise<IVcDiffsResponse>
}

describe('VcHandler — handleDiffs (mode-based)', () => {
  let sandbox: SinonSandbox
  let tmpDir: string

  beforeEach(() => {
    sandbox = createSandbox()
    tmpDir = join(tmpdir(), `brv-vc-diff-files-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
    mkdirSync(tmpDir, {recursive: true})
  })

  afterEach(() => {
    sandbox.restore()
    if (existsSync(tmpDir)) rmSync(tmpDir, {force: true, recursive: true})
  })

  describe('setup', () => {
    it('registers the vc:diffs handler', () => {
      const deps = makeDeps(sandbox, '/fake/project', tmpDir)
      makeVcHandler(deps).setup()
      const events = deps.transport.onRequest.args.map((a: unknown[]) => a[0])
      expect(events).to.include(VcEvents.DIFFS)
    })
  })

  describe('GIT_NOT_INITIALIZED guard', () => {
    it('throws VcError(GIT_NOT_INITIALIZED) when the repo is uninitialized', async () => {
      const deps = makeDeps(sandbox, '/fake/project', tmpDir)
      deps.gitService.isInitialized.resolves(false)
      makeVcHandler(deps).setup()

      try {
        await invoke(deps, {mode: {kind: 'unstaged'}})
        expect.fail('expected throw')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        expect((error as VcError).code).to.equal(VcErrorCode.GIT_NOT_INITIALIZED)
      }
    })
  })

  describe('unstaged mode (STAGE → WORKDIR)', () => {
    it('returns one IVcDiffFile per changed file with content from STAGE and working tree', async () => {
      writeFileSync(join(tmpDir, 'a.md'), 'workdir-a\n')
      const deps = makeDeps(sandbox, '/fake/project', tmpDir)
      deps.gitService.listChangedFiles.resolves([{path: 'a.md', status: 'modified'}])
      deps.gitService.getTextBlob.callsFake(async ({path, ref}: {path: string; ref: unknown}) => {
        if (path === 'a.md' && ref === 'STAGE') return {content: 'stage-a\n', oid: 'aaa1111'}
      })
      deps.gitService.hashBlob.resolves('bbb2222')

      makeVcHandler(deps).setup()
      const res = await invoke(deps, {mode: {kind: 'unstaged'}})

      expect(deps.gitService.listChangedFiles.calledOnce).to.equal(true)
      expect(deps.gitService.listChangedFiles.firstCall.args[0]).to.deep.equal({
        directory: tmpDir,
        from: 'STAGE',
        to: 'WORKDIR',
      })
      expect(res.diffs).to.have.lengthOf(1)
      expect(res.diffs[0]).to.include({
        newContent: 'workdir-a\n',
        newOid: 'bbb2222',
        oldContent: 'stage-a\n',
        oldOid: 'aaa1111',
        path: 'a.md',
        status: 'modified',
      })
    })

    it('echoes back the mode in the response', async () => {
      const deps = makeDeps(sandbox, '/fake/project', tmpDir)
      makeVcHandler(deps).setup()
      const res = await invoke(deps, {mode: {kind: 'unstaged'}})
      expect(res.mode).to.deep.equal({kind: 'unstaged'})
    })
  })

  describe('staged mode (HEAD → STAGE)', () => {
    it('passes from={commitish:HEAD} and to=STAGE to listChangedFiles', async () => {
      const deps = makeDeps(sandbox, '/fake/project', tmpDir)
      deps.gitService.listChangedFiles.resolves([])
      makeVcHandler(deps).setup()
      await invoke(deps, {mode: {kind: 'staged'}})
      expect(deps.gitService.listChangedFiles.firstCall.args[0]).to.deep.equal({
        directory: tmpDir,
        from: {commitish: 'HEAD'},
        to: 'STAGE',
      })
    })

    it('reads old side from HEAD commit and new side from STAGE for each file', async () => {
      const deps = makeDeps(sandbox, '/fake/project', tmpDir)
      deps.gitService.listChangedFiles.resolves([{path: 'b.md', status: 'modified'}])
      deps.gitService.getTextBlob.callsFake(async ({ref}: {ref: unknown}) => {
        if (typeof ref === 'object' && ref && 'commitish' in ref && (ref as {commitish: string}).commitish === 'HEAD') {
          return {content: 'head\n', oid: 'aaa1111'}
        }

        if (ref === 'STAGE') return {content: 'stage\n', oid: 'bbb2222'}
      })

      makeVcHandler(deps).setup()
      const res = await invoke(deps, {mode: {kind: 'staged'}})
      expect(res.diffs[0].oldContent).to.equal('head\n')
      expect(res.diffs[0].newContent).to.equal('stage\n')
    })
  })

  describe('ref-vs-worktree mode', () => {
    it('passes from={commitish:<ref>} and to=WORKDIR', async () => {
      const deps = makeDeps(sandbox, '/fake/project', tmpDir)
      deps.gitService.listChangedFiles.resolves([])
      makeVcHandler(deps).setup()
      await invoke(deps, {mode: {kind: 'ref-vs-worktree', ref: 'main'}})
      expect(deps.gitService.listChangedFiles.firstCall.args[0]).to.deep.equal({
        directory: tmpDir,
        from: {commitish: 'main'},
        to: 'WORKDIR',
      })
    })
  })

  describe('range mode', () => {
    it('passes from={commitish:<from>} and to={commitish:<to>}', async () => {
      const deps = makeDeps(sandbox, '/fake/project', tmpDir)
      deps.gitService.listChangedFiles.resolves([])
      makeVcHandler(deps).setup()
      await invoke(deps, {mode: {from: 'HEAD~3', kind: 'range', to: 'HEAD'}})
      expect(deps.gitService.listChangedFiles.firstCall.args[0]).to.deep.equal({
        directory: tmpDir,
        from: {commitish: 'HEAD~3'},
        to: {commitish: 'HEAD'},
      })
    })
  })

  describe('invalid ref classification', () => {
    it('rethrows iso-git NotFoundError from listChangedFiles as VcError(INVALID_REF)', async () => {
      const deps = makeDeps(sandbox, '/fake/project', tmpDir)
      const notFound = Object.assign(new Error("Could not find typo-branch."), {code: 'NotFoundError'})
      deps.gitService.listChangedFiles.rejects(notFound)
      makeVcHandler(deps).setup()

      try {
        await invoke(deps, {mode: {kind: 'ref-vs-worktree', ref: 'typo-branch'}})
        expect.fail('expected throw')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        expect((error as VcError).code).to.equal(VcErrorCode.INVALID_REF)
      }
    })

    it('rethrows iso-git NotFoundError from readSideEntry (range mode) as VcError(INVALID_REF)', async () => {
      const deps = makeDeps(sandbox, '/fake/project', tmpDir)
      deps.gitService.listChangedFiles.resolves([{path: 'a.md', status: 'modified'}])
      const notFound = Object.assign(new Error("Could not find bad-ref."), {code: 'NotFoundError'})
      deps.gitService.getTextBlob.rejects(notFound)
      makeVcHandler(deps).setup()

      try {
        await invoke(deps, {mode: {from: 'main', kind: 'range', to: 'bad-ref'}})
        expect.fail('expected throw')
      } catch (error) {
        expect(error).to.be.instanceOf(VcError)
        expect((error as VcError).code).to.equal(VcErrorCode.INVALID_REF)
      }
    })

    it('propagates non-isomorphic-git errors unchanged', async () => {
      const deps = makeDeps(sandbox, '/fake/project', tmpDir)
      const unrelated = new Error('disk full')
      deps.gitService.listChangedFiles.rejects(unrelated)
      makeVcHandler(deps).setup()

      try {
        await invoke(deps, {mode: {kind: 'unstaged'}})
        expect.fail('expected throw')
      } catch (error) {
        expect(error).to.equal(unrelated)
      }
    })
  })

  describe('binary marking (git-diff parity)', () => {
    it('marks a file binary=true with empty content when the working-tree side contains a NUL byte', async () => {
      writeFileSync(join(tmpDir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]))
      writeFileSync(join(tmpDir, 'a.md'), 'workdir-a\n')
      const deps = makeDeps(sandbox, '/fake/project', tmpDir)
      deps.gitService.listChangedFiles.resolves([
        {path: 'logo.png', status: 'modified'},
        {path: 'a.md', status: 'modified'},
      ])
      deps.gitService.getTextBlob.callsFake(async ({path}: {path: string}) => {
        if (path === 'a.md') return {content: 'stage-a\n', oid: 'aaa1111'}
        if (path === 'logo.png') return {binary: true, content: '', oid: 'ccc3333'}
      })
      deps.gitService.hashBlob.resolves('bbb2222')

      makeVcHandler(deps).setup()
      const res = await invoke(deps, {mode: {kind: 'unstaged'}})

      expect(res.diffs).to.have.lengthOf(2)
      const logo = res.diffs.find((d) => d.path === 'logo.png')
      const aMd = res.diffs.find((d) => d.path === 'a.md')
      expect(logo?.binary).to.equal(true)
      expect(logo?.oldContent).to.equal('')
      expect(logo?.newContent).to.equal('')
      expect(aMd?.binary).to.equal(undefined)
      expect(aMd?.oldContent).to.equal('stage-a\n')
    })

    it('marks a file binary=true when the ref side returns {binary:true}', async () => {
      writeFileSync(join(tmpDir, 'logo.png'), 'text on disk but stage is binary')
      const deps = makeDeps(sandbox, '/fake/project', tmpDir)
      deps.gitService.listChangedFiles.resolves([{path: 'logo.png', status: 'modified'}])
      deps.gitService.getTextBlob.resolves({binary: true, content: '', oid: 'aaa1111'})
      deps.gitService.hashBlob.resolves('bbb2222')

      makeVcHandler(deps).setup()
      const res = await invoke(deps, {mode: {kind: 'unstaged'}})

      expect(res.diffs).to.have.lengthOf(1)
      expect(res.diffs[0].binary).to.equal(true)
      expect(res.diffs[0].oldContent).to.equal('')
      expect(res.diffs[0].newContent).to.equal('')
    })

    it('drops a file when getTextBlob returns undefined (blob absent, not binary)', async () => {
      writeFileSync(join(tmpDir, 'gone.md'), 'on disk')
      const deps = makeDeps(sandbox, '/fake/project', tmpDir)
      deps.gitService.listChangedFiles.resolves([{path: 'gone.md', status: 'modified'}])
      // STAGE side genuinely absent — not binary, not there at all.
      deps.gitService.getTextBlob.resolves()
      deps.gitService.hashBlob.resolves('bbb2222')

      makeVcHandler(deps).setup()
      const res = await invoke(deps, {mode: {kind: 'unstaged'}})

      expect(res.diffs).to.have.lengthOf(0)
    })
  })

  describe('added / deleted oid omission', () => {
    it('omits oldOid for added files (no blob existed before)', async () => {
      writeFileSync(join(tmpDir, 'new.md'), 'fresh\n')
      const deps = makeDeps(sandbox, '/fake/project', tmpDir)
      deps.gitService.listChangedFiles.resolves([{path: 'new.md', status: 'added'}])
      deps.gitService.getTextBlob.resolves()
      deps.gitService.hashBlob.resolves('bbb2222')

      makeVcHandler(deps).setup()
      const res = await invoke(deps, {mode: {kind: 'unstaged'}})
      expect(res.diffs[0].oldOid).to.equal(undefined)
      expect(res.diffs[0].newOid).to.equal('bbb2222')
    })

    it('omits newOid for deleted files (no blob exists after)', async () => {
      const deps = makeDeps(sandbox, '/fake/project', tmpDir)
      deps.gitService.listChangedFiles.resolves([{path: 'gone.md', status: 'deleted'}])
      deps.gitService.getTextBlob.callsFake(async ({ref}: {ref: unknown}) =>
        ref === 'STAGE' ? {content: 'gone\n', oid: 'aaa1111'} : undefined,
      )

      makeVcHandler(deps).setup()
      const res = await invoke(deps, {mode: {kind: 'unstaged'}})
      expect(res.diffs[0].oldOid).to.equal('aaa1111')
      expect(res.diffs[0].newOid).to.equal(undefined)
    })
  })
})
