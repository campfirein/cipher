/**
 * FolderPackExecutor tests
 *
 * 1. Variable naming regression: UUID hyphens in instructionsVar cause
 *    ReferenceError when the LLM calls instructionsVar.slice(...) in code-exec.
 *
 * 2. Workspace path resolution (PR3): relative folderPath resolves from clientCwd,
 *    absent folderPath defaults to worktreeRoot, absolute folderPath used as-is.
 */

import {expect} from 'chai'
import {mkdir, mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {restore, stub} from 'sinon'

import type {ICipherAgent} from '../../../../src/agent/core/interfaces/i-cipher-agent.js'
import type {IFolderPackService} from '../../../../src/agent/core/interfaces/i-folder-pack-service.js'

import {LocalSandbox} from '../../../../src/agent/infra/sandbox/local-sandbox.js'
import {FileContextTreeManifestService} from '../../../../src/server/infra/context-tree/file-context-tree-manifest-service.js'
import {FileContextTreeSnapshotService} from '../../../../src/server/infra/context-tree/file-context-tree-snapshot-service.js'
import {FileContextTreeSummaryService} from '../../../../src/server/infra/context-tree/file-context-tree-summary-service.js'
import {DreamLockService} from '../../../../src/server/infra/dream/dream-lock-service.js'
import {FolderPackExecutor} from '../../../../src/server/infra/executor/folder-pack-executor.js'

/**
 * Stub DreamLockService so Phase 4 tests don't hit a real filesystem
 * `<projectRoot>/.brv/dream.lock`. ENG-2522 added lock coordination around
 * propagateStaleness/buildManifest in folder-pack post-work.
 */
function stubDreamLockServiceDefaults(): void {
  stub(DreamLockService.prototype, 'tryAcquire').resolves({acquired: true, priorMtime: 0})
  stub(DreamLockService.prototype, 'release').resolves()
  stub(DreamLockService.prototype, 'rollback').resolves()
}

function createMockAgent(): ICipherAgent {
  return {
    cancel: stub().resolves(false),
    createTaskSession: stub().resolves('session-1'),
    deleteSandboxVariable: stub(),
    deleteSandboxVariableOnSession: stub(),
    deleteSession: stub().resolves(true),
    deleteTaskSession: stub().resolves(),
    execute: stub().resolves(''),
    executeOnSession: stub().resolves('curated'),
    generate: stub().resolves({content: '', toolCalls: [], usage: {inputTokens: 0, outputTokens: 0}}),
    getSessionMetadata: stub().resolves(),
    getState: stub().returns({currentIteration: 0, executionHistory: [], executionState: 'idle', toolCallsExecuted: 0}),
    listPersistedSessions: stub().resolves([]),
    reset: stub(),
    setSandboxVariable: stub(),
    setSandboxVariableOnSession: stub(),
    setupTaskForwarding: stub().returns(() => {}),
    start: stub().resolves(),
    stream: stub().resolves({[Symbol.asyncIterator]: () => ({next: () => Promise.resolve({done: true, value: undefined})})}),
  } as unknown as ICipherAgent
}

function createMockFolderPackService(packStub?: ReturnType<typeof stub>): IFolderPackService {
  return {
    generateXml: stub().returns('<packed_folder></packed_folder>'),
    initialize: stub().resolves(),
    pack: packStub ?? stub().resolves({fileCount: 1, files: [], totalLines: 10}),
  } as unknown as IFolderPackService
}

describe('FolderPackExecutor', () => {
  describe('instructionsVar naming (regression)', () => {
    const taskId = '8cd8e2d8-a7fc-4371-89ca-59460687c12d'
    const llmGeneratedVarName = '__curate_instructions_8cd8e2d8_a7fc_4371_89ca_59460687c12d'
    const instructions = 'Step 1: read files. Step 2: curate topics.'

    describe('bug: hyphenated taskId causes ReferenceError on .slice()', () => {
      it('should fail when instructionsVar stored with hyphens and LLM calls .slice()', async () => {
        const sandbox = new LocalSandbox()

        const buggyVar = `__curate_instructions_${taskId}`
        sandbox.updateContext({[buggyVar]: instructions})

        const result = await sandbox.execute(`${llmGeneratedVarName}.slice(0, 5)`)

        expect(result.stderr).to.include('ReferenceError')
      })
    })

    describe('fix: taskIdSafe with underscores matches LLM output', () => {
      it('should succeed when instructionsVar stored with underscores', async () => {
        const sandbox = new LocalSandbox()

        const taskIdSafe = taskId.replaceAll('-', '_')
        const fixedVar = `__curate_instructions_${taskIdSafe}`
        sandbox.updateContext({[fixedVar]: instructions})

        const result = await sandbox.execute(`${llmGeneratedVarName}.slice(0, 4)`)

        expect(result.stderr).to.equal('')
        expect(result.returnValue).to.equal('Step')
      })

      it('should correctly transform all UUID segments', () => {
        const taskIdSafe = taskId.replaceAll('-', '_')

        expect(taskIdSafe).to.not.include('-')
        expect(taskIdSafe).to.equal('8cd8e2d8_a7fc_4371_89ca_59460687c12d')

      const instructionsVar = `__curate_instructions_${taskIdSafe}`
      expect(instructionsVar).to.equal(llmGeneratedVarName)
    })
  })

  describe('summary propagation', () => {
  beforeEach(() => {
    stubDreamLockServiceDefaults()
  })

  afterEach(() => {
    restore()
  })

  it('instructs small-folder curation to avoid synthetic overview leaves', () => {
    const folderPackService = {} as IFolderPackService
    const executor = new FolderPackExecutor(folderPackService)

    const prompt = (
      executor as unknown as {
        buildIterativePromptWithFileAccess: (
          userContext: string | undefined,
          folderPath: string,
          tmpFilePath: string,
          fileCount: number,
          totalLines: number,
        ) => string
      }
    ).buildIterativePromptWithFileAccess(
      'curate auth module',
      '/workspace/src/auth',
      '/tmp/auth-pack.xml',
      2,
      120,
    )

    expect(prompt).to.include('For folders with 3 or fewer relevant source files')
    expect(prompt).to.include('Do **NOT** create an extra module/folder "overview" leaf at the bare topic path')
    expect(prompt).to.include('provide `topicContext`')
  })

  it('includes explicit source-file quota guidance in the compact prompt for small folders', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'folder-pack-executor-'))
    const folderPath = path.join(projectRoot, 'src', 'auth')
    await mkdir(folderPath, {recursive: true})

    const folderPackService = {
      generateXml: stub().returns('<packed_folder />'),
    } as unknown as IFolderPackService
    const executor = new FolderPackExecutor(folderPackService)
    const executeOnSession = stub().resolves('curated')
    const agent = {
      createTaskSession: stub().resolves('task-session-1'),
      deleteTaskSession: stub().resolves(),
      executeOnSession,
      setSandboxVariableOnSession: stub(),
    } as unknown as ICipherAgent

    await (
      executor as unknown as {
        executeIterative: (
          agent: ICipherAgent,
          packResult: import('../../../../src/agent/core/domain/folder-pack/types.js').FolderPackResult,
          userContext: string | undefined,
          folderPath: string,
          taskId: string,
          projectRoot: string,
        ) => Promise<string>
      }
    ).executeIterative(agent, {
      config: {
        extractDocuments: true,
        extractPdfText: true,
        ignore: [],
        include: ['**/*'],
        includeTree: true,
        maxFileSize: 10 * 1024 * 1024,
        maxLinesPerFile: 5000,
        useGitignore: true,
      },
      directoryTree: 'src/auth\n├── jwt.ts\n└── session.ts',
      durationMs: 1,
      fileCount: 2,
      files: [
        {content: 'export const issueJwt = () => {}', lineCount: 1, path: 'jwt.ts', size: 32, truncated: false},
        {content: 'export const createSession = () => {}', lineCount: 1, path: 'session.ts', size: 37, truncated: false},
      ],
      rootPath: folderPath,
      skippedCount: 0,
      skippedFiles: [],
      totalCharacters: 69,
      totalLines: 2,
    }, 'Analyze auth module', folderPath, 'task-123', projectRoot)

    const compactPrompt = executeOnSession.firstCall.args[1] as string
    expect(compactPrompt).to.include('Relevant source files: jwt.ts, session.ts')
    expect(compactPrompt).to.include('Relevant files variable: `__curate_files_task_123`')
    expect(compactPrompt).to.include('Leaf quota: create no more than 2 curated leaf knowledge files')
    expect(compactPrompt).to.include('A topic-level overview leaf counts toward that quota')
  })

  it('rebuilds summaries after curate-folder writes new knowledge', async () => {
    const packResult = {
      config: {
        extractDocuments: true,
        extractPdfText: true,
        ignore: [],
        include: ['**/*'],
        includeTree: true,
        maxFileSize: 10 * 1024 * 1024,
        maxLinesPerFile: 5000,
        useGitignore: true,
      },
      directoryTree: 'src/\n└── auth.ts',
      durationMs: 1,
      fileCount: 1,
      files: [],
      rootPath: '/workspace/src',
      skippedCount: 0,
      skippedFiles: [],
      totalCharacters: 0,
      totalLines: 0,
    }
    const folderPackService = {
      generateXml: stub().returns('<packed_folder />'),
      initialize: stub().resolves(),
      pack: stub().resolves(packResult),
    } as unknown as IFolderPackService

    const executor = new FolderPackExecutor(folderPackService)
    const executeIterativeStub = stub(
      executor as unknown as {executeIterative: (...args: unknown[]) => Promise<string>},
      'executeIterative',
    ).resolves('curated')
    const getCurrentStateStub = stub(FileContextTreeSnapshotService.prototype, 'getCurrentState')
    getCurrentStateStub
      .onFirstCall()
      .resolves(new Map())
      .onSecondCall()
      .resolves(new Map([['auth/jwt.md', {hash: 'hash-1', size: 123}]]))
    const propagateStalenessStub = stub(FileContextTreeSummaryService.prototype, 'propagateStaleness').resolves([
      {
        actionTaken: true,
        compressionRatio: 0.5,
        path: 'auth',
        tokenCount: 128,
      },
    ])
    const buildManifestStub = stub(FileContextTreeManifestService.prototype, 'buildManifest').resolves()

    const agent = {} as ICipherAgent
    const clientCwd = '/workspace'
    const response = await executor.executeWithAgent(agent, {
      clientCwd,
      content: 'curate auth module',
      folderPath: 'src',
      taskId: 'task-123',
    })

    expect(response).to.equal('curated')
    expect(executeIterativeStub.calledOnce).to.be.true
    expect(executeIterativeStub.firstCall.args[3]).to.equal(path.resolve(clientCwd, 'src'))
    expect(executeIterativeStub.firstCall.args[5]).to.equal(clientCwd)
    expect(propagateStalenessStub.calledOnceWithExactly(['auth/jwt.md'], agent, clientCwd, 'task-123')).to.be.true
    expect(buildManifestStub.calledOnceWithExactly(clientCwd)).to.be.true
  })

  it('waits for background work before returning curate-folder results', async () => {
    const packResult = {
      config: {
        extractDocuments: true,
        extractPdfText: true,
        ignore: [],
        include: ['**/*'],
        includeTree: true,
        maxFileSize: 10 * 1024 * 1024,
        maxLinesPerFile: 5000,
        useGitignore: true,
      },
      directoryTree: 'src/\n└── auth.ts',
      durationMs: 1,
      fileCount: 1,
      files: [],
      rootPath: '/workspace/src',
      skippedCount: 0,
      skippedFiles: [],
      totalCharacters: 0,
      totalLines: 0,
    }
    const folderPackService = {
      generateXml: stub().returns('<packed_folder />'),
      initialize: stub().resolves(),
      pack: stub().resolves(packResult),
    } as unknown as IFolderPackService

    const executor = new FolderPackExecutor(folderPackService)
    stub(
      executor as unknown as {executeIterative: (...args: unknown[]) => Promise<string>},
      'executeIterative',
    ).resolves('curated')
    stub(FileContextTreeSnapshotService.prototype, 'getCurrentState')
      .onFirstCall()
      .resolves(new Map())
      .onSecondCall()
      .resolves(new Map())

    const drainBackgroundWork = stub().resolves()
    const agent = {drainBackgroundWork} as unknown as ICipherAgent
    const response = await executor.executeWithAgent(agent, {
      clientCwd: '/workspace',
      content: 'curate auth module',
      folderPath: 'src',
      taskId: 'task-123',
    })

    expect(response).to.equal('curated')
    expect(drainBackgroundWork.calledOnce).to.be.true
  })
  })
})

  describe('workspace path resolution (PR3)', () => {
    let testDir: string

    beforeEach(async () => {
      testDir = path.join(tmpdir(), `brv-fp-test-${Date.now()}`)
      await mkdir(testDir, {recursive: true})
    })

    afterEach(async () => {
      restore()
      await rm(testDir, {force: true, recursive: true})
    })

    describe('relative folderPath resolves from clientCwd (shell semantics)', () => {
      it('should resolve relative folderPath from clientCwd, not worktreeRoot', async () => {
        const packStub = stub().resolves({fileCount: 1, files: [], totalLines: 10})
        const service = createMockFolderPackService(packStub)
        const executor = new FolderPackExecutor(service)
        const agent = createMockAgent()

        const clientCwd = path.join(testDir, 'packages/api')
        await mkdir(clientCwd, {recursive: true})

        await executor.executeWithAgent(agent, {
          clientCwd,
          folderPath: './src',
          projectRoot: testDir,
          taskId: 'task-1',
          worktreeRoot: path.join(testDir, 'packages/api'),
        })

        const resolvedPath = packStub.firstCall.args[0]
        expect(resolvedPath).to.equal(path.resolve(clientCwd, './src'))
      })
    })

    describe('absolute folderPath used as-is', () => {
      it('should use absolute folderPath without resolving', async () => {
        const packStub = stub().resolves({fileCount: 1, files: [], totalLines: 10})
        const service = createMockFolderPackService(packStub)
        const executor = new FolderPackExecutor(service)
        const agent = createMockAgent()

        const absoluteFolder = path.join(testDir, 'external')
        await mkdir(absoluteFolder, {recursive: true})

        await executor.executeWithAgent(agent, {
          clientCwd: testDir,
          folderPath: absoluteFolder,
          projectRoot: testDir,
          taskId: 'task-2',
        })

        const resolvedPath = packStub.firstCall.args[0]
        expect(resolvedPath).to.equal(absoluteFolder)
      })
    })

    describe('absent folderPath defaults to worktreeRoot', () => {
      it('should default to worktreeRoot when folderPath is not provided', async () => {
        const packStub = stub().resolves({fileCount: 1, files: [], totalLines: 10})
        const service = createMockFolderPackService(packStub)
        const executor = new FolderPackExecutor(service)
        const agent = createMockAgent()

        const worktreeRoot = path.join(testDir, 'packages/api')
        await mkdir(worktreeRoot, {recursive: true})

        await executor.executeWithAgent(agent, {
          clientCwd: path.join(worktreeRoot, 'src'),
          projectRoot: testDir,
          taskId: 'task-3',
          worktreeRoot,
        })

        const resolvedPath = packStub.firstCall.args[0]
        expect(resolvedPath).to.equal(worktreeRoot)
      })

      it('should fall back to clientCwd when both folderPath and worktreeRoot are absent', async () => {
        const packStub = stub().resolves({fileCount: 1, files: [], totalLines: 10})
        const service = createMockFolderPackService(packStub)
        const executor = new FolderPackExecutor(service)
        const agent = createMockAgent()

        await executor.executeWithAgent(agent, {
          clientCwd: testDir,
          projectRoot: testDir,
          taskId: 'task-4',
        })

        const resolvedPath = packStub.firstCall.args[0]
        expect(resolvedPath).to.equal(testDir)
      })
    })
  })
})
