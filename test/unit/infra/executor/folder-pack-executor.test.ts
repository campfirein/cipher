/**
 * FolderPackExecutor variable naming regression test
 *
 * Reproduces and verifies the fix for: UUID hyphens in instructionsVar cause
 * ReferenceError when the LLM calls instructionsVar.slice(...) in code-exec.
 *
 * Root cause: folder-pack-executor used raw taskId to name the instructionsVar
 * sandbox variable (e.g. "__curate_instructions_8cd8e2d8-a7fc-..."). The LLM
 * writes underscores when generating code-exec calls, causing a variable name
 * mismatch → ReferenceError.
 *
 * Fix: taskIdSafe = taskId.replaceAll('-', '_') before constructing instructionsVar.
 */

import {expect} from 'chai'
import {mkdir, mkdtemp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {restore, stub} from 'sinon'

import type {ICipherAgent} from '../../../../src/agent/core/interfaces/i-cipher-agent.js'
import type {IFolderPackService} from '../../../../src/agent/core/interfaces/i-folder-pack-service.js'

import {LocalSandbox} from '../../../../src/agent/infra/sandbox/local-sandbox.js'
import {FileContextTreeManifestService} from '../../../../src/server/infra/context-tree/file-context-tree-manifest-service.js'
import {FileContextTreeSnapshotService} from '../../../../src/server/infra/context-tree/file-context-tree-snapshot-service.js'
import {FileContextTreeSummaryService} from '../../../../src/server/infra/context-tree/file-context-tree-summary-service.js'
import {FolderPackExecutor} from '../../../../src/server/infra/executor/folder-pack-executor.js'

describe('FolderPackExecutor - instructionsVar naming (regression)', () => {
  const taskId = '8cd8e2d8-a7fc-4371-89ca-59460687c12d'
  const llmGeneratedVarName = '__curate_instructions_8cd8e2d8_a7fc_4371_89ca_59460687c12d'
  const instructions = 'Step 1: read files. Step 2: curate topics.'

  describe('bug: hyphenated taskId causes ReferenceError on .slice()', () => {
    it('should fail when instructionsVar stored with hyphens and LLM calls .slice()', async () => {
      const sandbox = new LocalSandbox()

      // Old (buggy) behavior: variable name contains hyphens
      const buggyVar = `__curate_instructions_${taskId}`
      sandbox.updateContext({[buggyVar]: instructions})

      // LLM writes: __curate_instructions_8cd8e2d8_a7fc_....slice(0, 5000)
      // JS parses hyphens as subtraction → ReferenceError on the identifier
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
    expect(propagateStalenessStub.calledOnceWithExactly(['auth/jwt.md'], agent, clientCwd)).to.be.true
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
