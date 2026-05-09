/**
 * End-to-end wiring test for `vc:rm` — exercises the full chain
 * VcHandler → IsomorphicGitService → fs (real tmpdir, no mocks).
 *
 * Stubs only the deps that handleRm does not touch (token store, space/team services,
 * project-config store, broadcast). The git service and the filesystem are real.
 *
 * Catches regressions in the handler→service contract that the unit-level tests
 * (which mock `gitService.remove`) cannot.
 */

import {expect} from 'chai'
import * as git from 'isomorphic-git'
import fs, {existsSync} from 'node:fs'
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {ITokenStore} from '../../src/server/core/interfaces/auth/i-token-store.js'
import type {IContextTreeService} from '../../src/server/core/interfaces/context-tree/i-context-tree-service.js'
import type {ISpaceService} from '../../src/server/core/interfaces/services/i-space-service.js'
import type {ITeamService} from '../../src/server/core/interfaces/services/i-team-service.js'
import type {IProjectConfigStore} from '../../src/server/core/interfaces/storage/i-project-config-store.js'
import type {
  ITransportServer,
  RequestHandler,
} from '../../src/server/core/interfaces/transport/i-transport-server.js'
import type {IVcGitConfigStore} from '../../src/server/core/interfaces/vc/i-vc-git-config-store.js'

import {AuthToken} from '../../src/server/core/domain/entities/auth-token.js'
import {IsomorphicGitService} from '../../src/server/infra/git/isomorphic-git-service.js'
import {VcHandler} from '../../src/server/infra/transport/handlers/vc-handler.js'
import {
  type IVcRmRequest,
  type IVcRmResponse,
  VcEvents,
} from '../../src/shared/transport/events/vc-events.js'

const CLIENT_ID = 'client-e2e'

type Stubbed<T> = {[K in keyof T]: SinonStub & T[K]}

type WiredDeps = {
  contextTreeDir: string
  invoke: <T>(event: string, data: unknown) => Promise<T>
  service: IsomorphicGitService
}

async function wire(sandbox: SinonSandbox, contextTreeDir: string): Promise<WiredDeps> {
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

  const contextTreeService: Stubbed<IContextTreeService> = {
    delete: sandbox.stub().resolves(),
    exists: sandbox.stub().resolves(true),
    hasGitRepo: sandbox.stub().resolves(true),
    initialize: sandbox.stub().resolves(contextTreeDir),
    resolvePath: sandbox.stub().returns(contextTreeDir),
  }

  const tokenStore: Stubbed<ITokenStore> = {
    clear: sandbox.stub().resolves(),
    load: sandbox.stub().resolves(
      new AuthToken({
        accessToken: 'tok',
        expiresAt: new Date(Date.now() + 3_600_000),
        refreshToken: 'ref',
        sessionKey: 'sess',
        userEmail: 'e2e@example.com',
        userId: 'u',
      }),
    ),
    save: sandbox.stub().resolves(),
  }

  const teamService: Stubbed<ITeamService> = {getTeams: sandbox.stub().resolves({teams: [], total: 0})}
  const spaceService: Stubbed<ISpaceService> = {getSpaces: sandbox.stub().resolves({spaces: [], total: 0})}
  const vcGitConfigStore: Stubbed<IVcGitConfigStore> = {
    get: sandbox.stub().resolves({email: 'e2e@example.com', name: 'E2E'}),
    set: sandbox.stub().resolves(),
  }
  const projectConfigStore: Stubbed<IProjectConfigStore> = {
    exists: sandbox.stub().resolves(false),
    getModifiedTime: sandbox.stub().resolves(),
    read: sandbox.stub().resolves(),
    write: sandbox.stub().resolves(),
  }

  const authToken = new AuthToken({
    accessToken: 'tok',
    expiresAt: new Date(Date.now() + 3_600_000),
    refreshToken: 'ref',
    sessionKey: 'sess',
    userEmail: 'e2e@example.com',
    userId: 'u',
    userName: 'E2E',
  })

  const service = new IsomorphicGitService({
    getToken: sandbox.stub().returns(authToken),
    loadToken: sandbox.stub().resolves(authToken),
    onAuthChanged: sandbox.stub(),
    onAuthExpired: sandbox.stub(),
    startPolling: sandbox.stub(),
    stopPolling: sandbox.stub(),
  })

  const handler = new VcHandler({
    broadcastToProject: sandbox.stub(),
    contextTreeService,
    gitRemoteBaseUrl: 'https://byterover.dev',
    gitService: service,
    projectConfigStore,
    resolveProjectPath: sandbox.stub().returns(contextTreeDir),
    spaceService,
    teamService,
    tokenStore,
    transport,
    vcGitConfigStore,
    webAppUrl: 'https://test-app.byterover.dev',
  })
  handler.setup()

  const invoke = <T>(event: string, data: unknown): Promise<T> =>
    requestHandlers[event](data, CLIENT_ID) as Promise<T>

  return {contextTreeDir, invoke, service}
}

async function commitFile(svc: IsomorphicGitService, dir: string, filename: string, content: string): Promise<void> {
  await writeFile(join(dir, filename), content)
  await svc.add({directory: dir, filePaths: [filename]})
  await svc.commit({directory: dir, message: `add ${filename}`})
}

async function rowFor(dir: string, path: string): Promise<[number, number, number] | undefined> {
  const matrix = await git.statusMatrix({dir, fs})
  const found = matrix.find((r) => String(r[0]) === path)
  return found ? [found[1], found[2], found[3]] : undefined
}

describe('vc:rm e2e — VcHandler + real IsomorphicGitService', () => {
  let sandbox: SinonSandbox
  let testDir: string
  let deps: WiredDeps

  beforeEach(async () => {
    sandbox = createSandbox()
    testDir = join(tmpdir(), `brv-vc-rm-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
    await mkdir(testDir, {recursive: true})
    deps = await wire(sandbox, testDir)
    await deps.service.init({directory: testDir})
  })

  afterEach(async () => {
    sandbox.restore()
    if (existsSync(testDir)) await rm(testDir, {force: true, recursive: true})
  })

  it('default: full pipeline removes file from disk and index', async () => {
    await commitFile(deps.service, testDir, 'a.md', 'hello\n')

    const result = await deps.invoke<IVcRmResponse>(VcEvents.RM, {filePaths: ['a.md']} satisfies IVcRmRequest)

    expect(result.filesRemoved).to.equal(1)
    expect(result.perFile).to.deep.equal(["rm 'a.md'"])
    expect(existsSync(join(testDir, 'a.md'))).to.be.false
    expect(await rowFor(testDir, 'a.md')).to.deep.equal([1, 0, 0])
  })

  it('--cached: full pipeline removes only from index, lands at [1, w>0, 0]', async () => {
    await commitFile(deps.service, testDir, 'a.md', 'hello\n')

    const result = await deps.invoke<IVcRmResponse>(VcEvents.RM, {
      cached: true,
      filePaths: ['a.md'],
    } satisfies IVcRmRequest)

    expect(result.filesRemoved).to.equal(1)
    expect(existsSync(join(testDir, 'a.md'))).to.be.true
    expect(await readFile(join(testDir, 'a.md'), 'utf8')).to.equal('hello\n')
    const row = await rowFor(testDir, 'a.md')
    expect(row?.[0]).to.equal(1)
    expect(row?.[2]).to.equal(0)
  })

  it('-r: full pipeline removes a directory recursively', async () => {
    await mkdir(join(testDir, 'docs'), {recursive: true})
    await commitFile(deps.service, testDir, 'docs/a.md', 'a\n')
    await commitFile(deps.service, testDir, 'docs/b.md', 'b\n')

    const result = await deps.invoke<IVcRmResponse>(VcEvents.RM, {
      filePaths: ['docs/'],
      recursive: true,
    } satisfies IVcRmRequest)

    expect(result.filesRemoved).to.equal(2)
    expect(existsSync(join(testDir, 'docs/a.md'))).to.be.false
    expect(existsSync(join(testDir, 'docs/b.md'))).to.be.false
  })

  it('-n / dryRun: full pipeline reports plan without mutating', async () => {
    await commitFile(deps.service, testDir, 'a.md', 'hello\n')

    const before = await git.statusMatrix({dir: testDir, fs})
    const result = await deps.invoke<IVcRmResponse>(VcEvents.RM, {
      dryRun: true,
      filePaths: ['a.md'],
    } satisfies IVcRmRequest)
    const after = await git.statusMatrix({dir: testDir, fs})

    expect(result.dryRun).to.be.true
    expect(result.filesRemoved).to.equal(1)
    expect(result.perFile).to.deep.equal(["rm 'a.md'"])
    expect(existsSync(join(testDir, 'a.md'))).to.be.true
    expect(after).to.deep.equal(before)
  })

  it('--pathspec-from-file: full pipeline reads file, expands paths, removes them', async () => {
    await commitFile(deps.service, testDir, 'a.md', 'a\n')
    await commitFile(deps.service, testDir, 'b.md', 'b\n')
    const pathspecFile = join(testDir, 'paths.txt')
    await writeFile(pathspecFile, 'a.md\nb.md\n')

    const result = await deps.invoke<IVcRmResponse>(VcEvents.RM, {
      filePaths: [],
      pathspecFromFile: pathspecFile,
    } satisfies IVcRmRequest)

    expect(result.filesRemoved).to.equal(2)
    expect(existsSync(join(testDir, 'a.md'))).to.be.false
    expect(existsSync(join(testDir, 'b.md'))).to.be.false
  })

  it('--pathspec-file-nul: splits on NUL bytes only, removes the listed files', async () => {
    await commitFile(deps.service, testDir, 'a.md', 'a\n')
    await commitFile(deps.service, testDir, 'b.md', 'b\n')
    const pathspecFile = join(testDir, 'paths.nul')
    await writeFile(pathspecFile, Buffer.from('a.md\0b.md\0'))

    const result = await deps.invoke<IVcRmResponse>(VcEvents.RM, {
      filePaths: [],
      pathspecFileNul: true,
      pathspecFromFile: pathspecFile,
    } satisfies IVcRmRequest)

    expect(result.filesRemoved).to.equal(2)
    expect(existsSync(join(testDir, 'a.md'))).to.be.false
    expect(existsSync(join(testDir, 'b.md'))).to.be.false
  })

  it('--pathspec-file-nul: preserves embedded newlines in path entries (no split on newline)', async () => {
    const weirdName = 'odd\nname.md'
    await commitFile(deps.service, testDir, weirdName, 'data\n')
    const pathspecFile = join(testDir, 'paths.nul')
    // Bytes: `odd\nname.md\0` — NUL is the only separator; the literal \n inside the
    // path must NOT cause a split. Asserts byte-true separator semantics.
    await writeFile(pathspecFile, Buffer.from(`${weirdName}\0`))

    const result = await deps.invoke<IVcRmResponse>(VcEvents.RM, {
      filePaths: [],
      pathspecFileNul: true,
      pathspecFromFile: pathspecFile,
    } satisfies IVcRmRequest)

    expect(result.filesRemoved).to.equal(1)
    expect(result.perFile).to.deep.equal([`rm '${weirdName}'`])
    expect(existsSync(join(testDir, weirdName))).to.be.false
  })
})
