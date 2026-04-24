/**
 * WebUI ↔ backend contract tests for the diff events.
 *
 * Guards against regression on what the WebUI diff viewer sends and receives.
 * If either side drifts, these tests fail.
 *
 * The WebUI depends on:
 *  - `vc:diff` accepting `{path, side: 'staged'|'unstaged'}` and returning `{oldContent, newContent, path}`
 *  - `vc:diffs` accepting `{paths, side}` and returning `{diffs: [{oldContent, newContent, path}]}`
 *
 * When `handleDiffs` became polymorphic in ENG-744 (also accepts `{mode}`), these tests
 * lock in that the legacy WebUI shape still works identically.
 */

import {expect} from 'chai'
import {existsSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {ITokenStore} from '../../../../../../src/server/core/interfaces/auth/i-token-store.js'
import type {IContextTreeService} from '../../../../../../src/server/core/interfaces/context-tree/i-context-tree-service.js'
import type {IGitService} from '../../../../../../src/server/core/interfaces/services/i-git-service.js'
import type {ISpaceService} from '../../../../../../src/server/core/interfaces/services/i-space-service.js'
import type {ITeamService} from '../../../../../../src/server/core/interfaces/services/i-team-service.js'
import type {IProjectConfigStore} from '../../../../../../src/server/core/interfaces/storage/i-project-config-store.js'
import type {ITransportServer, RequestHandler} from '../../../../../../src/server/core/interfaces/transport/i-transport-server.js'
import type {IVcGitConfigStore} from '../../../../../../src/server/core/interfaces/vc/i-vc-git-config-store.js'

import {AuthToken} from '../../../../../../src/server/core/domain/entities/auth-token.js'
import {VcHandler} from '../../../../../../src/server/infra/transport/handlers/vc-handler.js'
import {
  type IVcDiffRequest,
  type IVcDiffResponse,
  type IVcDiffsRequest,
  type IVcDiffsResponse,
  VcEvents,
} from '../../../../../../src/shared/transport/events/vc-events.js'

type Stubbed<T> = {[K in keyof T]: SinonStub & T[K]}

const CLIENT_ID = 'webui-contract-client'

interface TestDeps {
  contextTreeDir: string
  gitService: Stubbed<IGitService>
  requestHandlers: Record<string, RequestHandler>
}

function makeDeps(sandbox: SinonSandbox, contextTreeDir: string): TestDeps {
  const gitService = {
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

  const contextTreeService: Stubbed<IContextTreeService> = {
    delete: sandbox.stub().resolves(),
    exists: sandbox.stub().resolves(false),
    hasGitRepo: sandbox.stub().resolves(false),
    initialize: sandbox.stub().resolves(contextTreeDir),
    resolvePath: sandbox.stub().returns(contextTreeDir),
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

  const tokenStore: Stubbed<ITokenStore> = {
    clear: sandbox.stub().resolves(),
    load: sandbox.stub().resolves(
      new AuthToken({
        accessToken: 'a',
        expiresAt: new Date(Date.now() + 3_600_000),
        refreshToken: 'r',
        sessionKey: 's',
        userEmail: 'u@u.com',
        userId: 'u',
      }),
    ),
    save: sandbox.stub().resolves(),
  }

  const handler = new VcHandler({
    broadcastToProject: sandbox.stub(),
    contextTreeService,
    gitRemoteBaseUrl: 'https://br.dev',
    gitService,
    projectConfigStore: {
      exists: sandbox.stub().resolves(false),
      getModifiedTime: sandbox.stub().resolves(),
      read: sandbox.stub().resolves(),
      write: sandbox.stub().resolves(),
    } as unknown as Stubbed<IProjectConfigStore>,
    resolveProjectPath: sandbox.stub().returns('/fake/project'),
    spaceService: {getSpaces: sandbox.stub().resolves({spaces: [], total: 0})} as unknown as Stubbed<ISpaceService>,
    teamService: {getTeams: sandbox.stub().resolves({teams: [], total: 0})} as unknown as Stubbed<ITeamService>,
    tokenStore,
    transport,
    vcGitConfigStore: {get: sandbox.stub().resolves(), set: sandbox.stub().resolves()} as unknown as Stubbed<IVcGitConfigStore>,
    webAppUrl: 'https://br.dev',
  })
  handler.setup()

  return {contextTreeDir, gitService, requestHandlers}
}

describe('WebUI ↔ backend diff contract', () => {
  let sandbox: SinonSandbox
  let tmpDir: string

  beforeEach(() => {
    sandbox = createSandbox()
    tmpDir = join(tmpdir(), `brv-webui-contract-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
    mkdirSync(tmpDir, {recursive: true})
  })

  afterEach(() => {
    sandbox.restore()
    if (existsSync(tmpDir)) rmSync(tmpDir, {force: true, recursive: true})
  })

  describe('vc:diff — single-file payload (WebUI diff tab)', () => {
    it('accepts {path, side: "staged"} → returns {path, oldContent, newContent}', async () => {
      const deps = makeDeps(sandbox, tmpDir)
      deps.gitService.getBlobContent.callsFake(async ({path, ref}: {path: string; ref: unknown}) => {
        if (path === 'hello.md' && typeof ref === 'object' && ref && 'commitish' in ref) return 'v1-head\n'
        if (path === 'hello.md' && ref === 'STAGE') return 'v2-stage\n'
      })

      // Exact payload shape the WebUI builds in src/webui/features/vc/api/get-vc-diff.ts
      const webuiRequest: IVcDiffRequest = {path: 'hello.md', side: 'staged'}
      const response = (await deps.requestHandlers[VcEvents.DIFF](webuiRequest, CLIENT_ID)) as IVcDiffResponse

      expect(response).to.have.property('path', 'hello.md')
      expect(response).to.have.property('oldContent', 'v1-head\n')
      expect(response).to.have.property('newContent', 'v2-stage\n')
    })

    it('accepts {path, side: "unstaged"} → returns {path, oldContent, newContent}', async () => {
      writeFileSync(join(tmpDir, 'hello.md'), 'v3-workdir\n')
      const deps = makeDeps(sandbox, tmpDir)
      deps.gitService.getBlobContent.callsFake(async ({path, ref}: {path: string; ref: unknown}) => {
        if (path === 'hello.md' && ref === 'STAGE') return 'v2-stage\n'
      })

      const webuiRequest: IVcDiffRequest = {path: 'hello.md', side: 'unstaged'}
      const response = (await deps.requestHandlers[VcEvents.DIFF](webuiRequest, CLIENT_ID)) as IVcDiffResponse

      expect(response.path).to.equal('hello.md')
      expect(response.oldContent).to.equal('v2-stage\n')
      expect(response.newContent).to.equal('v3-workdir\n')
    })
  })

  describe('vc:diffs — legacy batched payload (WebUI status view)', () => {
    it('accepts {paths, side: "staged"} → returns {diffs: [{path, oldContent, newContent, ...}]}', async () => {
      const deps = makeDeps(sandbox, tmpDir)
      deps.gitService.getBlobContents
        .withArgs({directory: tmpDir, paths: ['a.md', 'b.md'], ref: {commitish: 'HEAD'}})
        .resolves({'a.md': 'a-head', 'b.md': 'b-head'})
      deps.gitService.getBlobContents
        .withArgs({directory: tmpDir, paths: ['a.md', 'b.md'], ref: 'STAGE'})
        .resolves({'a.md': 'a-stage', 'b.md': 'b-stage'})

      const webuiRequest: IVcDiffsRequest = {paths: ['a.md', 'b.md'], side: 'staged'}
      const response = (await deps.requestHandlers[VcEvents.DIFFS](webuiRequest, CLIENT_ID)) as IVcDiffsResponse

      expect(response.diffs).to.have.lengthOf(2)
      // WebUI reads exactly these three fields per entry
      expect(response.diffs[0]).to.include({newContent: 'a-stage', oldContent: 'a-head', path: 'a.md'})
      expect(response.diffs[1]).to.include({newContent: 'b-stage', oldContent: 'b-head', path: 'b.md'})
      // Order preserved (WebUI depends on this)
      expect(response.diffs.map((d) => d.path)).to.deep.equal(['a.md', 'b.md'])
    })

    it('accepts {paths, side: "unstaged"} → returns diffs with workdir content', async () => {
      writeFileSync(join(tmpDir, 'foo.md'), 'foo-workdir')
      writeFileSync(join(tmpDir, 'bar.md'), 'bar-workdir')
      const deps = makeDeps(sandbox, tmpDir)
      deps.gitService.getBlobContents
        .withArgs({directory: tmpDir, paths: ['foo.md', 'bar.md'], ref: 'STAGE'})
        .resolves({'bar.md': 'bar-stage', 'foo.md': 'foo-stage'})

      const webuiRequest: IVcDiffsRequest = {paths: ['foo.md', 'bar.md'], side: 'unstaged'}
      const response = (await deps.requestHandlers[VcEvents.DIFFS](webuiRequest, CLIENT_ID)) as IVcDiffsResponse

      expect(response.diffs[0]).to.include({newContent: 'foo-workdir', oldContent: 'foo-stage', path: 'foo.md'})
      expect(response.diffs[1]).to.include({newContent: 'bar-workdir', oldContent: 'bar-stage', path: 'bar.md'})
    })

    it('legacy response shape does NOT include `mode` field (WebUI caller never sends mode)', async () => {
      const deps = makeDeps(sandbox, tmpDir)
      const webuiRequest: IVcDiffsRequest = {paths: ['x.md'], side: 'staged'}
      const response = (await deps.requestHandlers[VcEvents.DIFFS](webuiRequest, CLIENT_ID)) as IVcDiffsResponse

      // `mode` is only echoed when the request used `{mode}`. Legacy WebUI calls omit it.
      expect(response.mode).to.be.undefined
    })

    it('extra fields (status/oid/binary/truncated) on each diff entry are forward-compat — WebUI ignores them', async () => {
      const deps = makeDeps(sandbox, tmpDir)
      deps.gitService.getBlobContents.resolves({'x.md': 'content'})

      const webuiRequest: IVcDiffsRequest = {paths: ['x.md'], side: 'staged'}
      const response = (await deps.requestHandlers[VcEvents.DIFFS](webuiRequest, CLIENT_ID)) as IVcDiffsResponse

      // Shape assertion: the 3 fields WebUI actually reads
      const [entry] = response.diffs
      expect(entry).to.have.property('path')
      expect(entry).to.have.property('oldContent')
      expect(entry).to.have.property('newContent')
      // Any extra fields (like `status`) are present but the test deliberately does NOT assert
      // on them — they're extension points the WebUI doesn't rely on.
    })
  })

  describe('mode-based call does NOT affect the legacy WebUI path', () => {
    it('when request includes `mode`, takes the mode branch; no paths/side read', async () => {
      const deps = makeDeps(sandbox, tmpDir)
      deps.gitService.listChangedFiles.resolves([])

      // A caller that sends {mode} (CLI/TUI) — handler must NOT fall into the legacy path.
      const modeRequest: IVcDiffsRequest = {mode: {kind: 'unstaged'}}
      const response = (await deps.requestHandlers[VcEvents.DIFFS](modeRequest, CLIENT_ID)) as IVcDiffsResponse

      // Mode-based responses echo the mode so the client can render headers.
      expect(response.mode).to.deep.equal({kind: 'unstaged'})
      // listChangedFiles (mode path), NOT getBlobContents (legacy path), should have been called.
      expect(deps.gitService.listChangedFiles.called).to.equal(true)
      expect(deps.gitService.getBlobContents.called).to.equal(false)
    })
  })
})
